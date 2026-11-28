// test/ui-settings-engines.test.mjs — engine-settings-view.mjs, the cards Project settings, the setup assistant and
// Settings › Chat still draw: the setting-id mappers (Claude's helper jobs are its legacy settings keys: titleModel,
// autoWorkflowModel, prDescriptionModel, memoryDefrag, …), renderEngineSection's cards, renderAskEngineSection and
// renderRolesSection. The Models page's Jobs tab (models-menu P6) is test/ui-models-jobs-app.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderEngineSection, renderAskEngineSection, enginePatchToSettingsBody, ENGINE_EFFORTS, utilityId, renderRolesSection } from '../ui/public/engine-settings-view.mjs';
import { EFFORTS, CODEX_EFFORTS } from '../src/core/model-env.mjs';

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
  assert.match(card.querySelector('.engine-helpers .engine-slot-rest').textContent, /^Cursor runs its helper jobs \(titles, overview, PR description, Auto classifier, Away mode's decider\) on Claude\. Pick them under Claude Code\.$/);
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
      `${label} runs its helper jobs (titles, overview, PR description, Auto classifier, Away mode's decider) on Claude. Pick them under Claude Code.`);
    assert.deepEqual(enginePatchToSettingsBody({ [`models.${engine}.steps.planner`]: { model: 'm1' } }), { stepModels: { [engine]: { planner: { model: 'm1' } } } });
  });
}

test('renderAskEngineSection offers no Cursor engine', () => {
  const doc = new JSDOM('<!doctype html><div id="h"></div>').window.document;
  const host = doc.getElementById('h');
  renderAskEngineSection(host, { catalog: CATALOG });
  assert.deepEqual([...host.querySelectorAll('[data-setting="askEngine"] option')].map((o) => o.value).filter(Boolean), ['codex', 'copilot', 'gemini', 'goose', 'opencode', 'qwen'], 'Claude is the default option, listed once');
  assert.match(host.textContent, /Chat on [^.]*Qwen Code needs a model of their own: add one for each on the Models page\./, "engines that ship no model say how to get one");
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

test('enginePatchToSettingsBody: Command summaries saves onto commandSummaryModel (Claude only)', () => {
  assert.deepEqual(enginePatchToSettingsBody({ 'models.claude.utility.commandSummary': { model: 'claude-opus-5-5', effort: 'high' } }),
    { commandSummaryModel: { model: 'claude-opus-5-5', effort: 'high' } });
  assert.deepEqual(enginePatchToSettingsBody({ 'models.claude.utility.commandSummary': null }), { commandSummaryModel: null });
  assert.deepEqual(enginePatchToSettingsBody({ 'models.codex.utility.commandSummary': { model: 'gpt-5.5' } }), {});
});

test('enginePatchToSettingsBody: Guide saves onto guideModel (Claude only)', () => {
  assert.deepEqual(enginePatchToSettingsBody({ 'models.claude.utility.guide': { model: 'claude-opus-5-5', effort: 'high' } }),
    { guideModel: { model: 'claude-opus-5-5', effort: 'high' } });
  assert.deepEqual(enginePatchToSettingsBody({ 'models.claude.utility.guide': null }), { guideModel: null });
  assert.deepEqual(enginePatchToSettingsBody({ 'models.codex.utility.guide': { model: 'gpt-5.5' } }), {});
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

// --- renderRolesSection (setup-assistant-design.md slice 1): the role rows the setup assistant draws ---------------
const ROLE_CATALOG = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', engine: 'claude', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', engine: 'claude', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', engine: 'claude', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false },
  { id: 'gpt-5.5', label: 'GPT-5.5', engine: 'codex', efforts: ['minimal', 'low', 'medium', 'high'], custom: false, builtin: true },
];

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

test('enginePatchToSettingsBody: the Second-opinion reviewer saves onto secondOpinionModel (Claude) and utilityModels (Codex)', () => {
  assert.equal(utilityId('claude', 'secondOpinion'), 'models.claude.secondOpinion');
  assert.deepEqual(enginePatchToSettingsBody({ 'models.claude.secondOpinion': { model: 'claude-opus-5-5', effort: 'high' } }),
    { secondOpinionModel: { model: 'claude-opus-5-5', effort: 'high' } });
  assert.deepEqual(enginePatchToSettingsBody({ 'models.claude.secondOpinion': null }), { secondOpinionModel: null });
  assert.deepEqual(enginePatchToSettingsBody({ 'models.codex.secondOpinion': { model: 'gpt-5.5', effort: 'low' } }),
    { utilityModels: { codex: { secondOpinion: { model: 'gpt-5.5', effort: 'low' } } } });
});

test('#1450 renderRolesSection: an empty role reads as its Worca default, offers "Let Claude Code decide", and reads it back as { cliDecides: true }', async () => {
  const { readRolesValues } = await import('../ui/public/engine-settings-view.mjs');
  const doc = new JSDOM('<!doctype html><div id="h"></div>').window.document;
  const host = doc.getElementById('h');
  const catalog = [{ id: 'claude-opus-5-5', label: 'Opus 5.5', engine: 'claude', harnesses: ['claude'], efforts: ['medium'] }];
  const roleDefaults = { claude: { deep: { model: 'claude-opus-5-5' }, everyday: { model: 'claude-opus-5-5' }, quick: { model: 'claude-opus-5-5' } } };
  renderRolesSection(host, { roles: { claude: { everyday: { cliDecides: true } } }, catalog, engines: ['claude'], roleDefaults });
  const sel = (r) => host.querySelector(`.inherit-field[data-setting="models.claude.roles.${r}"] .inherit-model`);
  assert.equal(sel('deep').options[0].textContent, 'Worca\'s default (Opus 5.5)');
  assert.equal(sel('deep').options[1].textContent, 'Let Claude Code decide');
  assert.deepEqual(readRolesValues(host).claude.everyday, { cliDecides: true }, 'a saved cliDecides is selected');
  assert.equal(readRolesValues(host).claude.deep, null);
  sel('deep').value = '__cli__';
  assert.deepEqual(readRolesValues(host).claude.deep, { cliDecides: true });
});

test('#1450 renderRolesSection: signed out, a saved "Let Claude Code decide" stays selected and survives a change elsewhere', async () => {
  const { readRolesValues } = await import('../ui/public/engine-settings-view.mjs');
  const { window } = new JSDOM('<!doctype html><div id="h"></div>');
  const host = window.document.getElementById('h');
  const catalog = [{ id: 'claude-opus-5-5', label: 'Opus 5.5', engine: 'claude', harnesses: ['claude'], efforts: ['medium'] }];
  const roleDefaults = { claude: { deep: { model: 'claude-opus-5-5' }, everyday: { model: 'claude-opus-5-5' }, quick: { model: 'claude-opus-5-5' } } };
  let last = null;
  renderRolesSection(host, { roles: { claude: { everyday: { cliDecides: true } } }, catalog, engines: ['claude'], roleDefaults,
    claudeAuth: 'signed-out', onChange: (next) => { last = next; } });
  const sel = (r) => host.querySelector(`.inherit-field[data-setting="models.claude.roles.${r}"] .inherit-model`);
  assert.equal(sel('everyday').value, '__cli__');
  assert.equal(sel('deep').querySelector('option[value="__cli__"]'), null, 'an empty role offers no default to decide over signed out');
  sel('deep').value = 'claude-opus-5-5'; sel('deep').dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.deepEqual(last.claude.everyday, { cliDecides: true });
  assert.deepEqual(last.claude.deep, { model: 'claude-opus-5-5' });
});
