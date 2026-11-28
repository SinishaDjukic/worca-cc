// test/models-jobs-model.test.mjs — the Jobs tab's draft, differences and save body (models-menu P6 Task 3, DESIGN
// JOB-1…JOB-10): what /api/settings holds under today's setting ids, which draft ids differ, the one POST
// /api/settings body built through today's two mappers, today's default words, and the tab's view model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobsSaved, jobValue, jobsDirty, jobsSaveBody, jobDefaultText, buildJobs } from '../ui/public/models/jobs-model.mjs';
import { ENGINE_NAMES, engineLabel } from '../src/shared/engine-switch.mjs';

/** Frozen all the way down: buildJobs and jobsSaveBody must not write into what they are given. */
const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
};

const CAT = deepFreeze([
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-opus-5', label: 'Opus 5', efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'] },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', efforts: ['medium', 'high', 'max'], hidden: true },
  { id: 'my-gw', label: 'My GW', custom: 'global', efforts: ['medium', 'high'] },
  { id: 'or-grok', label: 'xAI: Grok (OpenRouter)', custom: 'global', needsSignIn: true, signInReason: 'no_key', bridged: 'openai', upstreamModel: 'x-ai/grok' },
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', engine: 'codex', efforts: ['minimal', 'low', 'medium', 'high'] },
]);

const SETTINGS = deepFreeze({ runEngine: null, modelRoles: { claude: { deep: { model: 'claude-opus-5-5', effort: 'xhigh' } } },
  stepModels: { claude: { reviewer: { model: 'claude-opus-5-5', effort: 'max' }, implementer: { effort: 'high' } } },
  titleModel: 'claude-haiku-4-5', autoWorkflowModel: '', prDescriptionModel: '', agentGenModel: { model: null, effort: null },
  secondOpinionModel: null, memoryDefrag: { model: 'claude-haiku-4-5', effort: null }, designModels: {},
  utilityModels: { codex: { overview: { model: 'gpt-6.1-sol' } } } });
const STEPS = deepFreeze([{ key: 'planner', label: 'Plan' }, { key: 'refiner', label: 'Refine' }, { key: 'implementer', label: 'Implement' },
  { key: 'reviewer', label: 'Review' }, { key: 'manualTestsChecklist', label: 'Manual tests checklist' }]);
const ALL_READY = deepFreeze(ENGINE_NAMES.map((name) => ({ name, label: engineLabel(name), ready: true })));
const DATA = (settings, flags = {}) => ({ settings: deepFreeze(settings), steps: STEPS, catalog: CAT, engines: ALL_READY, locks: [], flags,
  testable: new Set(['claude-opus-5-5', 'claude-haiku-4-5']) });
const VIEW = (engine) => ({ engine, showAll: { steps: false, helpers: false }, revealed: new Set() });
const showAll = (engine, part) => ({ ...VIEW(engine), showAll: { steps: part === 'steps', helpers: part === 'helpers' } });

const sectionOf = (vm, key) => vm.sections.find((s) => s.key === key);
const rowOf = (sec, name) => sec.rows.find((r) => r.name === name);
const build = (settings, engine = 'claude', { flags = {}, draft = {}, view = VIEW(engine) } = {}) => buildJobs(DATA(settings, flags), deepFreeze(draft), view);

test('1. jobsSaved reads every source under today\'s ids', () => {
  assert.deepEqual(jobsSaved(SETTINGS), {
    'models.claude.roles.deep': { model: 'claude-opus-5-5', effort: 'xhigh' },
    'models.claude.steps.reviewer': { model: 'claude-opus-5-5', effort: 'max' },
    'models.claude.steps.implementer': { effort: 'high' },
    'models.claude.utility.title': { model: 'claude-haiku-4-5' },
    'models.claude.memoryDefrag': { model: 'claude-haiku-4-5' },
    'models.codex.utility.overview': { model: 'gpt-6.1-sol' },
  });
  // The other shapes GET /api/settings answers with: a null string slot, a pair with both halves null, the
  // Codex own-run jobs outside `utility.`, Design and the interview pair.
  assert.deepEqual(jobsSaved({ titleModel: null, namingModel: { model: null, effort: null }, secondOpinionModel: { model: 'claude-opus-5', effort: null },
    utilityModels: { codex: { workspaceScan: { effort: 'low' }, memoryDefrag: { model: 'gpt-6.1-sol', effort: 'high' } } },
    designModels: { codex: { lead: { model: 'gpt-6.1-sol', effort: 'high' } } }, requirementsInterview: { effort: 'high' } }), {
    'models.claude.secondOpinion': { model: 'claude-opus-5' },
    'models.claude.requirementsInterview': { effort: 'high' },
    'models.codex.workspaceScan': { effort: 'low' },
    'models.codex.memoryDefrag': { model: 'gpt-6.1-sol', effort: 'high' },
    'models.codex.design.lead': { model: 'gpt-6.1-sol', effort: 'high' },
  });
  assert.deepEqual(jobsSaved(null), {});
});

test('2. dirty counts real differences only', () => {
  const saved = jobsSaved(SETTINGS);
  assert.deepEqual(jobsDirty({}, saved), []);
  assert.deepEqual(jobsDirty({ 'models.claude.roles.deep': { model: 'claude-opus-5-5', effort: 'xhigh' } }, saved), []);
  assert.deepEqual(jobsDirty({ 'models.claude.roles.quick': null }, saved), []);
  assert.deepEqual(jobsDirty({ 'models.claude.memoryDefrag': { model: 'claude-haiku-4-5' } }, saved), []);
  assert.deepEqual(jobsDirty({ 'models.claude.steps.reviewer': { model: 'claude-opus-5-5', effort: 'xhigh' }, 'models.claude.roles.deep': null }, saved),
    ['models.claude.roles.deep', 'models.claude.steps.reviewer']);
  // jobValue: the draft wins when it holds the id (null = cleared), else what is saved, else null.
  assert.deepEqual(jobValue('models.claude.steps.reviewer', {}, saved), { model: 'claude-opus-5-5', effort: 'max' });
  assert.equal(jobValue('models.claude.steps.reviewer', { 'models.claude.steps.reviewer': null }, saved), null);
  assert.equal(jobValue('models.claude.steps.planner', {}, saved), null);
});

test('3. one body, each id under its own key', () => {
  const saved = jobsSaved(SETTINGS);
  const draft = deepFreeze({ 'models.claude.roles.everyday': { model: 'claude-sonnet-5-5' },
    'models.codex.steps.implementer': { model: 'gpt-6.1-sol', effort: 'high' }, 'models.claude.utility.title': null,
    'models.claude.design.lead': { model: 'claude-opus-5-5', effort: 'xhigh' } });
  assert.deepEqual(jobsSaveBody(draft, saved), { modelRoles: { claude: { everyday: { model: 'claude-sonnet-5-5' } } },
    stepModels: { codex: { implementer: { model: 'gpt-6.1-sol', effort: 'high' } } }, titleModel: '',
    designModels: { claude: { lead: { model: 'claude-opus-5-5', effort: 'xhigh' } } } });
  assert.deepEqual(jobsSaveBody({}, saved), {});
  // An id whose draft equals what is saved is not sent again.
  assert.deepEqual(jobsSaveBody({ 'models.claude.memoryDefrag': { model: 'claude-haiku-4-5' }, 'models.claude.roles.quick': null }, saved), {});
});

test('4. roles: three tiles in MODEL_ROLES order', () => {
  const vm = build(SETTINGS);
  assert.deepEqual(vm.roles.map((r) => [r.name, r.sub, r.text, r.effortText]), [
    ['Deep thinking', 'Plans and reviews', 'Opus 5.5', 'xhigh effort'],
    ['Everyday tasks', 'Code and Chat answers', "Each job's own default", ''],
    ['Quick jobs', 'Short helper calls', "Each job's own default", ''],
  ]);
  assert.deepEqual(vm.roles.map((r) => r.id), ['models.claude.roles.deep', 'models.claude.roles.everyday', 'models.claude.roles.quick']);
  assert.equal(build({ ...SETTINGS, modelRoles: { claude: { deep: { model: 'claude-opus-5-5' } } } }).roles[0].effortText, 'Model default effort');
  // A stored effort with no model (only a hand-edited settings.json holds one) still shows its effort.
  const effortOnly = build({ ...SETTINGS, modelRoles: { claude: { deep: { effort: 'high' } } } }).roles[0];
  assert.deepEqual([effortOnly.text, effortOnly.effortText, effortOnly.model], ["Each job's own default", 'high effort', null]);
  // A tile's picker clears back to each job's own default (the prototype's words).
  assert.deepEqual(vm.roles.map((r) => r.clearLabel), Array(3).fill("Each job's own default"));
});

test('5. steps fold: own rows first, the rest summed up', () => {
  const steps = sectionOf(build(SETTINGS), 'steps');
  assert.deepEqual(steps.rows.map((r) => [r.name, r.own, r.text, r.effort, r.sub]), [
    ['Implement', true, "The workflow's model", 'high', 'Instead of Everyday tasks'],
    ['Review', true, 'Opus 5.5', 'max', 'Instead of Deep thinking'],
  ]);
  assert.equal(steps.moreText, "2 more follow their role · 1 uses Worca's default");
  assert.equal(steps.count, 5);
  assert.equal(steps.overrideLabel, 'Override a step');
  assert.equal(steps.title, 'Steps');
  assert.equal(steps.canFold, true);

  const all = sectionOf(build(SETTINGS, 'claude', { view: showAll('claude', 'steps') }), 'steps');
  assert.equal(all.rows.length, 5);
  assert.equal(all.showingAll, true);
  const plan = rowOf(all, 'Plan');
  assert.deepEqual([plan.text, plan.effort, plan.inherit], ['From Deep thinking · Opus 5.5', 'xhigh', true]);
  assert.equal(plan.sub, '');
  assert.equal(plan.clearLabel, 'Follow Deep thinking');
  assert.equal(plan.allowEffortOnly, true);
  assert.equal(rowOf(all, 'Manual tests checklist').text, "The workflow's model");
  assert.equal(all.moreText, "2 more follow their role · 1 uses Worca's default");

  const cursor = sectionOf(build(SETTINGS, 'cursor', { view: showAll('cursor', 'steps') }), 'steps');
  assert.equal(rowOf(cursor, 'Manual tests checklist').text, "Cursor's default model");
  assert.equal(cursor.moreText, "5 use Worca's default");

  // Rule 4: an own effort-only step shows what it would show without a value: its role's phrase once the role is set.
  const everyday = sectionOf(build({ ...SETTINGS, modelRoles: { claude: { everyday: { model: 'claude-haiku-4-5', effort: 'medium' } } } }), 'steps');
  const impl = rowOf(everyday, 'Implement');
  assert.deepEqual([impl.own, impl.text, impl.effort, impl.model], [true, 'From Everyday tasks · Haiku 4.5', 'high', null]);
});

test('6. helper jobs follow flags and today\'s default words', () => {
  const helpersOf = (settings, flags, engine = 'claude') => sectionOf(build(settings, engine, { flags, view: showAll(engine, 'helpers') }), 'helpers');
  const named = helpersOf(SETTINGS, { smartRunNaming: false, requirements: true });
  assert.equal(rowOf(named, 'Run naming'), undefined);
  assert.ok(rowOf(named, 'Requirements interview'));
  const bare = helpersOf(SETTINGS, {});
  assert.equal(rowOf(bare, 'Command summaries'), undefined);
  assert.equal(rowOf(bare, 'Titles').modelOnly, true);
  assert.equal(bare.overrideLabel, 'Override a helper job');
  assert.equal(bare.title, 'Helper jobs');

  const factory = { ...SETTINGS, factoryModels: { claude: { helpers: { secondOpinion: { model: 'claude-opus-5-5', effort: 'medium' } } } } };
  const second = rowOf(helpersOf(factory, {}), 'Second-opinion reviewer');
  assert.deepEqual([second.clearLabel, second.text, second.effort], ["Worca's default", 'Opus 5.5 (default)', 'medium (default)']);

  const auto = { ...SETTINGS, commandSummaryModelEffective: { model: 'claude-haiku-4-5', effort: 'medium', source: 'auto' } };
  const cs = rowOf(helpersOf(auto, { commandSummaries: true }), 'Command summaries');
  assert.deepEqual([cs.text, cs.effort], ['Haiku 4.5 (default)', '']);
  const fromSettings = { ...SETTINGS, commandSummaryModelEffective: { model: 'claude-haiku-4-5', effort: 'medium', source: 'settings' } };
  assert.equal(rowOf(helpersOf(fromSettings, { commandSummaries: true }), 'Command summaries').text, 'The default model');

  const cursor = helpersOf(SETTINGS, {}, 'cursor');
  assert.equal(cursor.rows.length, 0);
  assert.equal(cursor.count, 0);
  assert.match(cursor.note, /^Cursor runs its helper jobs/);
  assert.equal(cursor.overrideLabel, '');

  // A job that keeps a model only never runs at its role's effort: it follows the model alone.
  const quick = { ...SETTINGS, modelRoles: { claude: { quick: { model: 'claude-haiku-4-5', effort: 'high' } } } };
  const quickJobs = helpersOf(quick, { smartRunNaming: true });
  assert.deepEqual(['PR description', 'Run naming'].map((n) => [rowOf(quickJobs, n).text, rowOf(quickJobs, n).effort]),
    [['From Quick jobs · Haiku 4.5', ''], ['From Quick jobs · Haiku 4.5', 'high']]);

  const codex = helpersOf(SETTINGS, {}, 'codex');
  assert.equal(rowOf(codex, 'Titles').text, "OpenAI Codex's default model");
  assert.equal(rowOf(codex, 'Run overview').text, 'GPT-6.1 Sol');
});

test('6b. R-qa-13: Guide is a helper job only with shaperSmallRuns, names its default model and saves guideModel', () => {
  const id = 'models.claude.utility.guide';
  const guideOf = (settings, flags, { draft = {}, engine = 'claude' } = {}) =>
    rowOf(sectionOf(build(settings, engine, { flags, draft, view: showAll(engine, 'helpers') }), 'helpers'), 'Guide');
  assert.equal(guideOf(SETTINGS, {}), undefined, 'flag off: no row');
  assert.equal(guideOf(SETTINGS, { shaperSmallRuns: false, commandSummaries: true }), undefined);
  assert.equal(guideOf(SETTINGS, { shaperSmallRuns: true }, { engine: 'codex' }), undefined, 'Claude only');
  const auto = { ...SETTINGS, guideModel: { model: null, effort: null },
    guideModelEffective: { model: 'claude-haiku-4-5', effort: 'medium', source: 'auto' } };
  const row = guideOf(auto, { shaperSmallRuns: true });
  assert.ok(row, 'flag on: the Guide row');
  assert.deepEqual([row.id, row.text, row.effort], [id, 'Haiku 4.5 (default)', '']);
  const named = { ...SETTINGS, guideModelEffective: { model: 'claude-haiku-4-5', effort: 'medium', source: 'settings' } };
  assert.equal(guideOf(named, { shaperSmallRuns: true }).text, 'The default model');
  assert.doesNotMatch(rowOf(sectionOf(buildJobs({ ...DATA(BASE55), catalog: CAT55, flags: { shaperSmallRuns: true } }, {},
    showAll('claude', 'helpers')), 'helpers'), 'Guide').text, /Worca default/, 'unset, it runs on the cheapest ready model');
  // The pick: stored under guideModel, posted under guideModel.
  const saved = { 'models.claude.utility.guide': { model: 'claude-opus-5-5' } };
  assert.deepEqual(jobsSaved({ guideModel: { model: 'claude-opus-5-5', effort: null } }), saved);
  assert.deepEqual(jobsSaveBody({ [id]: { model: 'claude-opus-5-5' } }, {}), { guideModel: { model: 'claude-opus-5-5', effort: '' } });
  assert.deepEqual(jobsSaveBody({ [id]: null }, saved), { guideModel: null });
});

test('7. Requirements interview keeps today\'s words', () => {
  const settings = { ...SETTINGS, modelRoles: { claude: { deep: { model: 'claude-opus-5-5', effort: 'xhigh' }, everyday: { model: 'claude-haiku-4-5' } } },
    requirementsInterviewDefault: { model: 'claude-opus-5-5', effort: 'medium' } };
  const helpers = sectionOf(build(settings, 'claude', { flags: { requirements: true }, view: showAll('claude', 'helpers') }), 'helpers');
  const ri = rowOf(helpers, 'Requirements interview');
  assert.deepEqual([ri.text, ri.effort, ri.clearLabel], ['Opus 5.5 (default)', 'medium (default)', "Worca's default"]);
  assert.equal(ri.role, null);
  assert.deepEqual(helpers.choices.find((c) => c.name === 'Requirements interview').group, null);
  // Not own: Auto workflow classifier and Agent generation follow the Everyday role; PR description (Quick unset),
  // the Second-opinion reviewer and the interview use Worca's default.
  assert.equal(helpers.moreText, "2 more follow their role · 3 use Worca's default");
  const noDefault = { ...settings, requirementsInterviewDefault: { model: null, effort: 'medium' } };
  const ri2 = rowOf(sectionOf(build(noDefault, 'claude', { flags: { requirements: true }, view: showAll('claude', 'helpers') }), 'helpers'), 'Requirements interview');
  assert.equal(ri2.text, 'The default model');
  // An own effort-only interview shows the same words, never the role's.
  const own = sectionOf(build({ ...settings, requirementsInterview: { effort: 'high' } }, 'claude', { flags: { requirements: true } }), 'helpers');
  const ri3 = rowOf(own, 'Requirements interview');
  assert.deepEqual([ri3.own, ri3.text, ri3.effort, ri3.sub], [true, 'Opus 5.5 (default)', 'high', "Instead of Worca's default"]);
});

test('8. Design rows follow the design flag and the harnesses Design builds on', () => {
  const has = (engine, flags) => !!sectionOf(build(SETTINGS, engine, { flags }), 'design');
  assert.deepEqual([has('claude', { design: true }), has('claude', {}), has('goose', { design: true }), has('codex', { design: true })], [true, false, false, true]);
  const codex = sectionOf(build(SETTINGS, 'codex', { flags: { design: true } }), 'design');
  assert.equal(rowOf(codex, 'Design lead').text, "Codex's default model");
  assert.deepEqual(codex.rows.map((r) => r.name), ['Design lead', 'Design builders']);
  assert.deepEqual([codex.title, codex.overrideLabel, codex.canFold, codex.moreText, codex.count], ['Design', '', false, '', 2]);
  const claude = sectionOf(build(SETTINGS, 'claude', { flags: { design: true } }), 'design');
  assert.equal(rowOf(claude, 'Design lead').text, 'From Deep thinking · Opus 5.5');
  assert.equal(rowOf(claude, 'Design builders').text, 'The default model');
  const copilot = sectionOf(build(SETTINGS, 'copilot', { flags: { design: true } }), 'design');
  assert.equal(rowOf(copilot, 'Design builders').text, "GitHub Copilot's default model");
});

test('9. the draft shows, counts and can be revealed', () => {
  const draft = { 'models.claude.roles.quick': { model: 'claude-haiku-4-5' }, 'models.claude.steps.reviewer': null };
  const view = { ...VIEW('claude'), revealed: new Set(['models.claude.steps.planner']) };
  const vm = build(SETTINGS, 'claude', { draft, view });
  assert.equal(vm.roles[2].text, 'Haiku 4.5');
  assert.deepEqual([vm.dirty, vm.dirtyText], [2, '2 unsaved changes']);
  const steps = sectionOf(vm, 'steps');
  assert.equal(rowOf(steps, 'Review'), undefined);
  assert.equal(rowOf(steps, 'Plan').own, false);
  assert.deepEqual(steps.rows.map((r) => r.name), ['Implement', 'Plan']);
  // A revealed row has left the fold: Refine and Review follow Deep thinking, the checklist uses Worca's default.
  assert.equal(steps.moreText, "2 more follow their role · 1 uses Worca's default");
  assert.equal(build(SETTINGS, 'claude', { draft: { 'models.claude.roles.quick': { model: 'claude-haiku-4-5' } } }).dirtyText, '1 unsaved change');
  // Every step with a value of its own: nothing left to fold.
  const allOwn = Object.fromEntries(STEPS.map((s) => [`models.claude.steps.${s.key}`, { effort: 'high' }]));
  const folded = sectionOf(build(SETTINGS, 'claude', { draft: allOwn }), 'steps');
  assert.deepEqual([folded.canFold, folded.moreText, folded.rows.length], [false, '', 5]);
  // A change on another harness counts too.
  assert.equal(build(SETTINGS, 'claude', { draft: { 'models.codex.utility.title': { model: 'gpt-6.1-sol' } } }).dirty, 1);
});

test('10. a stored model the catalogue lost stays visible', () => {
  const steps = sectionOf(build({ ...SETTINGS, stepModels: { claude: { reviewer: { model: 'gone' } } } }), 'steps');
  const row = steps.rows.find((r) => r.id === 'models.claude.steps.reviewer');
  assert.deepEqual([row.text, row.missing, row.canTest], ['gone (not in the catalog)', true, false]);
  const review = rowOf(sectionOf(build(SETTINGS), 'steps'), 'Review');
  assert.deepEqual([review.canTest, review.missing, review.model?.id], [true, false, 'claude-opus-5-5']);
  // A role whose model is gone: its tile says so; a row following it names the id, as today's empty option does.
  const goneRole = build({ ...SETTINGS, modelRoles: { claude: { deep: { model: 'gone' } } } }, 'claude', { view: showAll('claude', 'steps') });
  assert.equal(goneRole.roles[0].text, 'gone (not in the catalog)');
  assert.equal(rowOf(sectionOf(goneRole, 'steps'), 'Plan').text, 'From Deep thinking · gone');
});

test('11. default harness and readiness', () => {
  const codexDown = [{ name: 'codex', label: 'OpenAI Codex', ready: false, reason: 'its CLI is not installed.' }];
  const vm = buildJobs({ ...DATA(SETTINGS), engines: codexDown }, {}, VIEW('codex'));
  assert.deepEqual([vm.isDefault, vm.canDefault, vm.reason], [false, true, "OpenAI Codex can't start runs yet: its CLI is not installed."]);
  assert.deepEqual([vm.engine, vm.engineLabel, vm.defaultEngine, vm.defaultTitle], ['codex', 'OpenAI Codex', 'claude', '']);
  const locked = buildJobs({ ...DATA(SETTINGS), engines: codexDown, locks: [{ name: 'codex', reason: 'Off while the credential broker is on' }] }, {}, VIEW('codex'));
  assert.deepEqual([locked.canDefault, locked.defaultTitle], [false, 'Off while the credential broker is on']);
  const gemini = buildJobs({ ...DATA(SETTINGS), engines: [{ name: 'gemini', label: 'Gemini CLI', ready: true, reason: 'its quota is low' }] }, {}, VIEW('gemini'));
  assert.equal(gemini.reason, 'Gemini CLI can start runs: its CLI is installed and signed in. Note: its quota is low.');
  assert.equal(buildJobs({ ...DATA(SETTINGS), engines: null }, {}, VIEW('codex')).reason, '');
  assert.equal(build(SETTINGS, 'claude').reason, '');
  // A configured remote backend adds whether Worca signs the harness's model calls inside its sandbox (#826).
  const boxed = (engines, engine) => buildJobs({ ...DATA(SETTINGS), engines }, {}, VIEW(engine)).reason;
  assert.equal(boxed([{ name: 'copilot', label: 'Copilot', ready: true, reason: null, sandbox: { titles: ['E2B'], ready: false, reason: 'COPILOT_GITHUB_TOKEN is not set' } }], 'copilot'),
    'Remote sandbox (E2B): COPILOT_GITHUB_TOKEN is not set.');
  assert.equal(boxed([{ name: 'cursor', label: 'Cursor', ready: false, reason: 'cursor-agent is not signed in', sandbox: { titles: ['E2B'], ready: true, reason: null } }], 'cursor'),
    "Cursor can't start runs yet: cursor-agent is not signed in. Remote sandbox (E2B): Worca can sign its model calls from the sandbox.");
  assert.equal(boxed([{ name: 'codex', label: 'Codex', ready: true, reason: null }], 'codex'), '', 'no sandbox entry: the line stays as it was');
  const claude = build(SETTINGS, 'claude');
  assert.deepEqual([claude.isDefault, claude.canDefault], [true, false]);
  // The default harness is settings.runEngine when it names one.
  const codexDefault = { ...SETTINGS, runEngine: 'codex' };
  const onCodex = build(codexDefault, 'codex');
  assert.deepEqual([onCodex.defaultEngine, onCodex.isDefault, onCodex.canDefault], ['codex', true, false]);
  assert.deepEqual([build(codexDefault, 'claude').isDefault, build(codexDefault, 'claude').canDefault], [false, true]);
});

test('12. override choices list every job with its role group', () => {
  const steps = sectionOf(build(SETTINGS), 'steps');
  assert.deepEqual(steps.choices.map((c) => c.name), STEPS.map((s) => s.label));
  assert.deepEqual(steps.choices.filter((c) => c.taken).map((c) => c.name), ['Implement', 'Review']);
  assert.equal(steps.choices.find((c) => c.name === 'Plan').group, 'deep');
  assert.equal(steps.choices.find((c) => c.name === 'Plan').id, 'models.claude.steps.planner');
});

test('jobDefaultText: today\'s words by row', () => {
  const opts = (engine, settings = SETTINGS) => ({ engine, settings, catalog: CAT });
  assert.deepEqual(jobDefaultText('models.copilot.steps.planner', opts('copilot')), { text: "The workflow's model", effort: '' });
  assert.deepEqual(jobDefaultText('models.qwen.steps.planner', opts('qwen')), { text: "Qwen Code's default model", effort: '' });
  assert.deepEqual(jobDefaultText('models.claude.utility.agentGen', opts('claude')), { text: 'The default model', effort: '' });
  assert.deepEqual(jobDefaultText('models.codex.workspaceScan', opts('codex')), { text: "OpenAI Codex's default model", effort: '' });
  const factory = { ...SETTINGS, factoryModels: { claude: { helpers: { memoryDefrag: { model: 'claude-sonnet-5' } } } } };
  assert.deepEqual(jobDefaultText('models.claude.memoryDefrag', opts('claude', factory)), { text: 'claude-sonnet-5 (default)', effort: '' });
  assert.deepEqual(jobDefaultText('models.claude.secondOpinion', opts('claude')), { text: 'The default model', effort: '' });
  assert.deepEqual(jobDefaultText('models.gemini.design.lead', opts('gemini')), { text: "Gemini CLI's default model", effort: '' });
  // The id names its harness.
  assert.deepEqual(jobDefaultText('models.codex.utility.title', opts('claude')), { text: "OpenAI Codex's default model", effort: '' });
});

// --- #1450: what "Default" resolves to ----------------------------------------
const CAT55 = deepFreeze([...CAT, { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: ['medium'] }, { id: 'claude-haiku-5-5', label: 'Haiku 5.5', efforts: ['medium'] },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', engine: 'codex' }, { id: 'gpt-6-luna', label: 'GPT-6 Luna', engine: 'codex' }]);
const ROLE_DEFAULTS = deepFreeze({
  claude: { deep: { model: 'claude-opus-5-5' }, everyday: { model: 'claude-sonnet-5-5' }, quick: { model: 'claude-haiku-5-5' } },
  codex: { deep: { model: 'gpt-5.6-sol' }, everyday: { model: 'gpt-6.1-sol' }, quick: { model: 'gpt-6-luna' } },
});
const build55 = (settings, engine = 'claude') => buildJobs({ ...DATA(settings), catalog: CAT55 }, {}, VIEW(engine));
const BASE55 = { runEngine: null, roleDefaults: ROLE_DEFAULTS, claudeAuth: 'signed-in' };

test('#1450 role tiles: empty → "Worca default · <model>", cliDecides → "Let Claude Code decide", tool-decides elsewhere', () => {
  const vm = build55(BASE55);
  assert.deepEqual(vm.roles.map((r) => r.text), ['Worca default · Opus 5.5', 'Worca default · Sonnet 5.5', 'Worca default · Haiku 5.5']);
  assert.deepEqual(vm.roles.map((r) => r.clearLabel), ["Worca's default (Opus 5.5)", "Worca's default (Sonnet 5.5)", "Worca's default (Haiku 5.5)"]);
  assert.deepEqual(vm.roles.map((r) => r.decideLabel), Array(3).fill('Let Claude Code decide'));
  const cli = build55({ ...BASE55, modelRoles: { claude: { deep: { cliDecides: true } } } });
  assert.deepEqual([cli.roles[0].text, cli.roles[0].value, cli.roles[0].effortText], ['Let Claude Code decide', { cliDecides: true }, '']);
  assert.equal(build55(BASE55, 'codex').roles[0].text, 'Worca default · GPT-5.6 Sol');
  assert.equal(build55(BASE55, 'codex').roles[0].decideLabel, 'Let Codex decide');
  const copilot = build55(BASE55, 'copilot');
  assert.deepEqual(copilot.roles.map((r) => r.text), Array(3).fill("GitHub Copilot decides: Worca can't know which model runs"));
  assert.deepEqual([copilot.roles[0].clearLabel, copilot.roles[0].decideLabel], ["GitHub Copilot decides: Worca can't know which model runs", '']);
  const out = build55({ ...BASE55, claudeAuth: 'signed-out' });
  assert.equal(out.roles[0].text, "Claude Code decides: Worca can't know which model runs", 'signed out, no Claude id can run');
});

test('#1450 job rows: "From <Role> · <model> (Worca default)", "From <Role> · <tool> decides"', () => {
  const show = (vm) => sectionOf(vm, 'steps').rows;
  const all = (settings, engine) => buildJobs({ ...DATA(settings), catalog: CAT55 }, {}, showAll(engine || 'claude', 'steps'));
  assert.equal(rowOf({ rows: show(all(BASE55)) }, 'Plan').text, 'From Deep thinking · Opus 5.5 (Worca default)');
  assert.equal(rowOf({ rows: show(all(BASE55)) }, 'Implement').text, 'From Everyday tasks · Sonnet 5.5 (Worca default)');
  assert.equal(rowOf({ rows: show(all({ ...BASE55, modelRoles: { claude: { deep: { cliDecides: true } } } })) }, 'Plan').text, 'From Deep thinking · Claude Code decides');
  assert.equal(rowOf({ rows: show(all(BASE55, 'codex')) }, 'Plan').text, 'From Deep thinking · GPT-5.6 Sol (Worca default)');
  const signedOut = rowOf({ rows: show(all({ ...BASE55, claudeAuth: 'signed-out' })) }, 'Plan').text;
  assert.doesNotMatch(signedOut, /Worca default/);
});

test('#1450 helper rows: Claude helpers with their own fallback never claim a Worca default; the others do', () => {
  const helpers = (engine) => sectionOf(buildJobs({ ...DATA(BASE55), catalog: CAT55, flags: { requirements: true, smartRunNaming: true, commandSummaries: true } }, {}, showAll(engine, 'helpers')), 'helpers').rows;
  const claude = Object.fromEntries(helpers('claude').map((r) => [r.id, r.text]));
  for (const id of ['models.claude.utility.title', 'models.claude.utility.classifier', 'models.claude.utility.naming',
    'models.claude.utility.commandSummary', 'models.claude.memoryDefrag', 'models.claude.requirementsInterview']) {
    assert.ok(id in claude, `${id} not in ${Object.keys(claude).join(', ')}`);
    assert.doesNotMatch(claude[id], /Worca default/, id);
  }
  assert.equal(claude['models.claude.utility.agentGen'], 'From Everyday tasks · Sonnet 5.5 (Worca default)');
  const codex = Object.fromEntries(helpers('codex').map((r) => [r.id, r.text]));
  assert.equal(codex['models.codex.utility.classifier'], 'From Quick jobs · GPT-6 Luna (Worca default)');
});

test('#1450: jobsSaved keeps a cliDecides role, and the save body posts it as { cliDecides: true }', () => {
  assert.deepEqual(jobsSaved({ modelRoles: { claude: { deep: { cliDecides: true } } } }), { 'models.claude.roles.deep': { cliDecides: true } });
  assert.deepEqual(jobsSaveBody({ 'models.claude.roles.deep': { cliDecides: true } }, {}), { modelRoles: { claude: { deep: { cliDecides: true } } } });
  assert.deepEqual(jobsDirty({ 'models.claude.roles.deep': { cliDecides: true } }, { 'models.claude.roles.deep': { cliDecides: true } }), []);
  assert.deepEqual(jobsDirty({ 'models.claude.roles.deep': null }, { 'models.claude.roles.deep': { cliDecides: true } }), ['models.claude.roles.deep']);
});

test('#1450 jobDefaultText: the stale "(GPT-5.6 Sol)" Codex default is gone', () => {
  assert.doesNotMatch(jobDefaultText('models.codex.utility.overview').text, /5\.6 Sol/);
  assert.doesNotMatch(jobDefaultText('models.codex.design.lead').text, /5\.6 Sol/);
});
