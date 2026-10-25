// test/ui-settings-engines.test.mjs — the Models page's Engines card (plans/cascading-settings-design.md §6): a Default
// engine row and a tab per engine with Step models and Helper jobs tables; Claude's helper jobs are its legacy settings
// keys (titleModel, autoWorkflowModel, prDescriptionModel, memoryDefrag); Save posts runEngine / stepModels / utilityModels.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { renderEngineSection, renderAskEngineSection, enginePatchToSettingsBody, ENGINE_EFFORTS, utilityId, renderRolesSection } from '../ui/public/engine-settings-view.mjs';
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
  assert.deepEqual([...host.querySelectorAll('[data-setting="askEngine"] option')].map((o) => o.value).filter(Boolean), ['codex', 'copilot'], 'Claude is the default option, listed once');
});

async function boot(settings = {}, { hash = 'settings', engines = null, flags = '', steps = STEPS, catalog = CATALOG, configStatus = 200, postReply = null } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  if (flags) window.document.documentElement.dataset.flags = flags;
  window.Element.prototype.scrollIntoView = function () {};
  // The socket keeps its listeners, so a test can deliver a server frame (settings-changed) through `window.__ws`.
  window.WebSocket = class { constructor() { this.readyState = 1; this.listeners = {}; window.__ws = this; } send() {} close() {} addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); } };
  const posts = [];
  const body = () => ({ root: '/w', projectsRoot: '/p', projectsRootDefault: '/p', default: {}, chat: {}, titleModel: null,
    titleModelEffective: { model: null, source: 'run', stale: null }, hideBuiltinModels: false, ...(typeof settings === 'function' ? settings(window) : settings) });
  window.fetch = (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    const ok = (b) => Promise.resolve({ ok: true, status: 200, json: async () => b });
    if (u.includes('/api/settings')) {
      if (method === 'POST') { const b = JSON.parse(opts.body); posts.push(b); if (postReply) return Promise.resolve(postReply); return ok({ ...body(), ...b }); }
      return ok(body());
    }
    if (u.includes('/api/projects')) return ok({ projects: [] });
    if (engines && u.endsWith('/api/engines')) return ok({ engines });
    if (configStatus !== 200) return Promise.resolve({ ok: false, status: configStatus, json: async () => ({ error: 'boom' }) });
    return ok({ config: { steps: {}, customModels: [] }, models: catalog, steps, efforts: ['medium', 'high'] });
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

test('requirementsInterview is a bare-id helper job and maps onto its own settings key (Codex never produces it)', () => {
  assert.equal(utilityId('claude', 'requirementsInterview'), 'models.claude.requirementsInterview');
  assert.deepEqual(enginePatchToSettingsBody({ 'models.claude.requirementsInterview': { model: 'claude-opus-5-5', effort: 'high' } }), { requirementsInterview: { model: 'claude-opus-5-5', effort: 'high' } });
  assert.deepEqual(enginePatchToSettingsBody({ 'models.claude.requirementsInterview': { model: 'claude-opus-5-5' } }), { requirementsInterview: { model: 'claude-opus-5-5' } });
  assert.deepEqual(enginePatchToSettingsBody({ 'models.claude.requirementsInterview': { effort: 'high' } }), { requirementsInterview: { effort: 'high' } });
  assert.deepEqual(enginePatchToSettingsBody({ 'models.claude.requirementsInterview': { model: '', effort: '' } }), { requirementsInterview: null });
  assert.deepEqual(enginePatchToSettingsBody({ 'models.claude.requirementsInterview': null }), { requirementsInterview: null });
  assert.deepEqual(enginePatchToSettingsBody({ 'models.codex.requirementsInterview': { model: 'gpt-5.5' } }), {});
});

const INTERVIEW_DEFAULT = { requirementsInterviewDefault: { model: 'claude-opus-5-5', effort: 'medium' } };

// As the server answers: the interview keys only while the requirements flag is on (ui/server.mjs settingsState).
const flagAware = (w) => (/(?:^|\s)requirements(?:\s|$)/.test(w.document.documentElement.dataset.flags || '') ? { ...INTERVIEW_DEFAULT } : {});

test('the Models page: the flag turning on while it is open refetches the settings, so the row shows its default', async () => {
  const off = await boot(flagAware, { hash: 'models' });
  assert.equal(off.doc.querySelector('[data-setting="models.claude.requirementsInterview"]'), null);
  const { applyFlags } = await import(pathToFileURL(fileURLToPath(new URL('../ui/public/flags.mjs', import.meta.url))).href);
  applyFlags({ requirements: true }, off.doc);
  for (let i = 0; i < 8; i++) await off.tick();
  const row = off.doc.querySelector('[data-setting="models.claude.requirementsInterview"]');
  assert.ok(row, 'the row appears');
  assert.equal(row.querySelector('.inherit-model').options[0].textContent, 'Opus 5.5 (default)');
  assert.match(row.querySelector('.inherit-effort').options[0].textContent, /medium \(default\)/);
});

test('the Models page: the Requirements interview row shows only while the requirements flag is on', async () => {
  const off = await boot(flagAware, { hash: 'models' });
  assert.equal(off.doc.querySelector('[data-setting="models.claude.requirementsInterview"]'), null);
  const { doc, tick } = await boot({ ...INTERVIEW_DEFAULT }, { hash: 'models', flags: 'requirements' });
  const row = doc.querySelector('.engine-card[data-engine="claude"] .engine-helpers [data-setting="models.claude.requirementsInterview"]');
  assert.ok(row, 'a Claude Helper jobs row');
  assert.equal(row.querySelector('.label-row label').textContent, 'Requirements interview');
  assert.equal(row.querySelector('.label-row label').title, 'Makes product briefs, looks at the code for a feature and runs the interview rounds on the Requirements page.');
  assert.equal(row.querySelector('.inherit-model').options[0].textContent, 'Opus 5.5 (default)');
  assert.ok(row.querySelector('.inherit-effort'), 'it has an Effort');
  assert.match(row.querySelector('.inherit-effort').options[0].textContent, /medium \(default\)/);
  assert.equal(doc.querySelector('.engine-card[data-engine="codex"] [data-setting="models.codex.requirementsInterview"]'), null);
  // The flag flipping repaints the card while the Models page is open.
  const { applyFlags } = await import(pathToFileURL(fileURLToPath(new URL('../ui/public/flags.mjs', import.meta.url))).href);
  applyFlags({ requirements: false }, doc);
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(doc.querySelector('[data-setting="models.claude.requirementsInterview"]'), null, 'flag off: the row goes');
  applyFlags({ requirements: true }, doc);
  for (let i = 0; i < 6; i++) await tick();
  assert.ok(doc.querySelector('[data-setting="models.claude.requirementsInterview"]'), 'flag on: the row is back');
});

test('the Models page: the interview row saves its pair, clears with x, and repaints from the answer', async () => {
  const { doc, window, posts, tick } = await boot({ ...INTERVIEW_DEFAULT, requirementsInterview: { model: 'claude-opus-5-5', effort: 'high' } }, { hash: 'models', flags: 'requirements' });
  const root = doc.getElementById('engine-settings-root');
  const row = () => root.querySelector('[data-setting="models.claude.requirementsInterview"]');
  assert.equal(row().querySelector('.inherit-model').value, 'claude-opus-5-5', 'the stored pick paints');
  assert.equal(row().querySelector('.inherit-effort').value, 'high');
  const change = (el, value) => { el.value = value; el.dispatchEvent(new window.Event('change', { bubbles: true })); };
  change(row().querySelector('.inherit-effort'), 'xhigh');
  doc.getElementById('engineSettingsSave').click();
  for (let i = 0; i < 6; i++) await tick();
  assert.deepEqual(posts.at(-1), { requirementsInterview: { model: 'claude-opus-5-5', effort: 'xhigh' } });
  assert.equal(row().querySelector('.inherit-effort').value, 'xhigh', 'repainted from the answer');
  assert.equal(row().querySelector('.inherit-model').options[0].textContent, 'Opus 5.5 (default)', 'default labels intact');
  row().querySelector('.inherit-clear').click();
  doc.getElementById('engineSettingsSave').click();
  for (let i = 0; i < 6; i++) await tick();
  assert.deepEqual(posts.at(-1), { requirementsInterview: null });
  assert.equal(row().hidden, true, 'cleared: back to the folded default');
  assert.equal(row().querySelector('.inherit-model').options[0].textContent, 'Opus 5.5 (default)');
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

test('enginePatchToSettingsBody: Command summaries saves onto commandSummaryModel (Claude only)', () => {
  assert.deepEqual(enginePatchToSettingsBody({ 'models.claude.utility.commandSummary': { model: 'claude-opus-5-5', effort: 'high' } }),
    { commandSummaryModel: { model: 'claude-opus-5-5', effort: 'high' } });
  assert.deepEqual(enginePatchToSettingsBody({ 'models.claude.utility.commandSummary': null }), { commandSummaryModel: null });
  assert.deepEqual(enginePatchToSettingsBody({ 'models.codex.utility.commandSummary': { model: 'gpt-5.5' } }), {});
});

test('the Models page: Command summaries is a Claude Helper jobs row while commandSummaries is on, the cheapest ready model by default', async () => {
  const { doc, window, posts, tick } = await boot({ commandSummaryModel: { model: null, effort: null },
    commandSummaryModelEffective: { model: 'claude-opus-5-5', effort: 'medium', source: 'auto', stale: null } }, { hash: 'models' });
  const sel = '[data-setting="models.claude.utility.commandSummary"]';
  applyFlags({ commandSummaries: false }, doc);
  for (let i = 0; i < 8; i++) await tick();
  assert.equal(doc.querySelector(sel), null, 'flag off: no row');
  applyFlags({ commandSummaries: true }, doc);
  for (let i = 0; i < 8; i++) await tick();
  const claude = doc.querySelector('.engine-card[data-engine="claude"]');
  const row = claude.querySelector(`.engine-helpers ${sel}`);
  assert.ok(row);
  assert.match(row.textContent, /Command summaries/);
  assert.ok([...claude.querySelectorAll('.engine-helpers .engine-slot-add option')].some((o) => o.textContent === 'Command summaries'), 'listed under Override a helper job');
  assert.equal(row.querySelector('.inherit-model').options[0].textContent, 'Opus 5.5 (default)', 'the cheapest ready Claude model, selected by default');
  assert.equal(doc.querySelector(`[data-setting*=".commandSummary"]:not(${sel})`), null, 'Claude only');
  const model = row.querySelector('.inherit-model');
  model.value = 'claude-opus-5-5'; model.dispatchEvent(new window.Event('change', { bubbles: true }));
  doc.getElementById('engineSettingsSave').click();
  for (let i = 0; i < 6; i++) await tick();
  assert.deepEqual(posts.at(-1), { commandSummaryModel: { model: 'claude-opus-5-5', effort: '' } });
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

// --- Models › Roles (setup-assistant-design.md slice 1, AC-1.5) -----------------------------------------------------
const ROLE_CATALOG = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', engine: 'claude', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', engine: 'claude', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', engine: 'claude', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false },
  { id: 'gpt-5.5', label: 'GPT-5.5', engine: 'codex', efforts: ['minimal', 'low', 'medium', 'high'], custom: false, builtin: true },
];
const ROLE_STEPS = [{ key: 'planner', label: 'Plan' }, { key: 'implementer', label: 'Implement' }, { key: 'reviewer', label: 'Review' }];
const EVERYDAY_SONNET = { claude: { everyday: { model: 'claude-sonnet-5-5', effort: 'medium' } } };
const bootRoles = (settings, opts = {}) => boot(settings, { hash: 'models', steps: ROLE_STEPS, catalog: ROLE_CATALOG, ...opts });
const emptyOption = (doc, id) => doc.querySelector(`#engine-settings-root [data-setting="${id}"] .inherit-model`).options[0].textContent;
const roleRow = (doc, engine, role) => doc.querySelector(`#model-roles-root [data-setting="models.${engine}.roles.${role}"]`);
const pickRole = (window, doc, engine, role, value) => {
  const sel = roleRow(doc, engine, role).querySelector('.inherit-model');
  sel.value = value; sel.dispatchEvent(new window.Event('change', { bubbles: true }));
};
const stepsRest = (doc) => doc.querySelector('#engine-settings-root .engine-card[data-engine="claude"] .engine-steps .engine-slot-rest').textContent;

test('Roles card: three rows; a role change rewrites the unset Engines rows before Save; clearing restores them', async () => {
  const { doc, window } = await bootRoles({ modelRoles: EVERYDAY_SONNET });
  const labels = [...doc.querySelectorAll('#model-roles-root .roles-engine[data-engine="claude"] .inherit-field label:not(.inherit-sub)')].map((l) => l.textContent);
  assert.deepEqual(labels, ['Deep thinking', 'Everyday coding', 'Quick jobs']);
  assert.equal(roleRow(doc, 'claude', 'deep').querySelector('.inherit-model').options[0].textContent, "Each job's own default");
  assert.equal(emptyOption(doc, 'models.claude.steps.implementer'), 'From Everyday coding · Sonnet 5.5');
  assert.equal(emptyOption(doc, 'models.claude.steps.planner'), "The workflow's model");
  pickRole(window, doc, 'claude', 'everyday', 'claude-opus-5-5');
  assert.equal(emptyOption(doc, 'models.claude.steps.implementer'), 'From Everyday coding · Opus 5.5');
  assert.equal(roleRow(doc, 'claude', 'everyday').querySelector('.inherit-effort').value, 'medium');
  assert.equal(emptyOption(doc, 'models.claude.steps.planner'), "The workflow's model");
  assert.equal(doc.getElementById('modelRolesMsg').textContent, '1 unsaved change');
  const clear = roleRow(doc, 'claude', 'everyday').querySelector('.inherit-clear');
  assert.equal(clear.getAttribute('aria-label'), 'Clear Everyday coding');
  assert.equal(clear.title, 'Clear: each job uses its own default');
  clear.click();
  assert.equal(emptyOption(doc, 'models.claude.steps.implementer'), "The workflow's model");
});

test('Roles card: the folded Step models summary follows the live roles', async () => {
  const all = { claude: { deep: { model: 'claude-opus-5-5' }, everyday: { model: 'claude-sonnet-5-5' }, quick: { model: 'claude-haiku-5-5' } } };
  const { doc } = await bootRoles({ modelRoles: all });
  assert.equal(stepsRest(doc), 'Every step follows its model role.');
  assert.equal(doc.querySelector('#engine-settings-root [data-setting="models.claude.steps.implementer"] .inherit-clear').title, 'Clear: follow Everyday coding');
  roleRow(doc, 'claude', 'deep').querySelector('.inherit-clear').click();
  assert.equal(stepsRest(doc), "Every step follows its model role or Worca's defaults.");
  assert.equal(doc.querySelector('#engine-settings-root [data-setting="models.claude.steps.planner"] .inherit-clear').title, "Clear: follow Worca's defaults");
});

test('Roles card: Save posts the dirty roles, then "Saved."; a second Save says "Nothing changed."', async () => {
  const { doc, window, posts, tick } = await bootRoles({ modelRoles: EVERYDAY_SONNET });
  pickRole(window, doc, 'claude', 'everyday', 'claude-opus-5-5');
  doc.getElementById('modelRolesSave').click();
  for (let i = 0; i < 6; i++) await tick();
  assert.deepEqual(posts.at(-1), { modelRoles: { claude: { everyday: { model: 'claude-opus-5-5', effort: 'medium' } } } });
  assert.equal(doc.getElementById('modelRolesMsg').textContent, 'Saved.');
  // The save's own settings-changed broadcast repaints the now clean card: "Saved." stays.
  for (const fn of window.__ws.listeners.message || []) fn({ data: JSON.stringify({ type: 'settings-changed' }) });
  for (let i = 0; i < 10; i++) await tick();
  assert.equal(doc.getElementById('modelRolesMsg').textContent, 'Saved.');
  const n = posts.length;
  doc.getElementById('modelRolesSave').click();
  for (let i = 0; i < 4; i++) await tick();
  assert.equal(posts.length, n);
  assert.equal(doc.getElementById('modelRolesMsg').textContent, 'Nothing changed.');
});

test('Roles card: a refused POST shows the server\'s message', async () => {
  const error = 'modelRoles.claude.everyday: unknown model "x"';
  const { doc, window, tick } = await bootRoles({}, { postReply: { ok: false, status: 400, json: async () => ({ error }) } });
  pickRole(window, doc, 'claude', 'everyday', 'claude-opus-5-5');
  doc.getElementById('modelRolesSave').click();
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(doc.getElementById('modelRolesMsg').textContent, error);
  assert.match(doc.getElementById('modelRolesMsg').className, /err/);
});

test('Roles card: a Roles Save and a settings-changed broadcast keep an unsaved Engines row', async () => {
  const { doc, window, tick } = await bootRoles({ modelRoles: EVERYDAY_SONNET });
  const impl = doc.querySelector('#engine-settings-root [data-setting="models.claude.steps.implementer"]');
  const sel = impl.querySelector('.inherit-model'); sel.value = 'claude-haiku-5-5'; sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  pickRole(window, doc, 'claude', 'deep', 'claude-opus-5-5');
  doc.getElementById('modelRolesSave').click();
  for (let i = 0; i < 6; i++) await tick();
  for (const fn of window.__ws.listeners.message || []) fn({ data: JSON.stringify({ type: 'settings-changed' }) });
  for (let i = 0; i < 10; i++) await tick();
  const now = doc.querySelector('#engine-settings-root [data-setting="models.claude.steps.implementer"]');
  assert.equal(now.querySelector('.inherit-model').value, 'claude-haiku-5-5');
  assert.equal(now.dataset.dirty, '1');
});

test('Roles card: a Roles row with unsaved changes survives an Engines Save', async () => {
  const { doc, window, tick } = await bootRoles({ modelRoles: EVERYDAY_SONNET });
  pickRole(window, doc, 'claude', 'quick', 'claude-haiku-5-5');
  const plan = doc.querySelector('#engine-settings-root [data-setting="models.claude.steps.planner"] .inherit-model');
  plan.value = 'claude-opus-5-5'; plan.dispatchEvent(new window.Event('change', { bubbles: true }));
  doc.getElementById('engineSettingsSave').click();
  for (let i = 0; i < 8; i++) await tick();
  assert.equal(roleRow(doc, 'claude', 'quick').dataset.dirty, '1');
  assert.equal(roleRow(doc, 'claude', 'quick').querySelector('.inherit-model').value, 'claude-haiku-5-5');
});

test('Roles card: a hand-set Engines row keeps its own model when its role changes', async () => {
  const { doc, window } = await bootRoles({ modelRoles: EVERYDAY_SONNET, stepModels: { claude: { implementer: { model: 'claude-haiku-5-5' } } } });
  pickRole(window, doc, 'claude', 'everyday', 'claude-opus-5-5');
  assert.equal(doc.querySelector('#engine-settings-root [data-setting="models.claude.steps.implementer"] .inherit-model').value, 'claude-haiku-5-5');
});

test('Roles card: on a Codex default the Codex panel shows and its rows read the Codex role', async () => {
  const { doc } = await bootRoles({ runEngine: 'codex', modelRoles: { codex: { everyday: { model: 'gpt-5.5' } } } });
  assert.equal(doc.querySelector('#model-roles-root .roles-engine[data-engine="codex"]').hidden, false);
  assert.equal(doc.querySelector('#model-roles-root .roles-engine[data-engine="claude"]').hidden, true);
  assert.equal(emptyOption(doc, 'models.codex.steps.implementer'), 'From Everyday coding · GPT-5.5');
  assert.equal(emptyOption(doc, 'models.claude.steps.implementer'), "The workflow's model");
});

test('Roles card: a failed catalog load says so on its own line, which stays through an edit', async () => {
  const { doc, window } = await bootRoles({}, { configStatus: 500 });
  const msg = doc.getElementById('modelRolesCatalogMsg');
  assert.equal(msg.hidden, false);
  assert.equal(msg.textContent, 'Could not load the model list. Reload the page to try again.');
  const effort = roleRow(doc, 'claude', 'deep').querySelector('.inherit-effort');
  effort.value = 'high'; effort.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(msg.hidden, false);
  assert.equal(doc.getElementById('modelRolesMsg').textContent, '1 unsaved change');
});

test('Roles card: the unsaved count covers the hidden harness panel', async () => {
  const { doc, window } = await bootRoles({});
  doc.querySelector('#model-roles-root .engine-switch button[data-engine="codex"]').click();
  pickRole(window, doc, 'codex', 'deep', 'gpt-5.5');
  doc.querySelector('#model-roles-root .engine-switch button[data-engine="claude"]').click();
  assert.equal(doc.querySelector('#model-roles-root .roles-engine[data-engine="codex"]').hidden, true);
  assert.equal(doc.getElementById('modelRolesMsg').textContent, '1 unsaved change');
});

test('Roles card: Simple level for the card, Expert for its harness switch', async () => {
  const { doc } = await bootRoles({});
  assert.equal(doc.getElementById('model-roles-card').dataset.minLevel, 'simple');
  assert.equal(doc.querySelector('#model-roles-root .engine-switch').dataset.minLevel, 'expert');
});

test('renderRolesSection: painting one host twice binds its listeners once', () => {
  const { window } = new JSDOM('<!doctype html><div id="h"></div>');
  const host = window.document.getElementById('h');
  let calls = 0;
  renderRolesSection(host, { catalog: ROLE_CATALOG, onChange: () => { calls += 1; } });
  renderRolesSection(host, { catalog: ROLE_CATALOG, onChange: () => { calls += 1; } });
  const sel = host.querySelector('[data-setting="models.claude.roles.deep"] .inherit-model');
  sel.value = 'claude-opus-5-5'; sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(calls, 1);
});
