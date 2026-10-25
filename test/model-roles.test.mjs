// test/model-roles.test.mjs — model roles (plans/setup-assistant-design.md D1–D5, slice 1): the slot → role table,
// the one resolver, and every slot's fallback order (D3) — own setting, then the role, then today's fallback.
// Sandboxes HOME/USERPROFILE (settings.json), WORCA_HOME (sqlite) and opts into the home fallback, so the model
// getters read the sandboxed settings file.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
const home = mkdtempSync(join(tmpdir(), 'worca-roles-home-'));
process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
const projectDir = mkdtempSync(join(tmpdir(), 'worca-roles-proj-'));
after(() => {
  for (const [k, v] of [['HOME', prev.HOME], ['USERPROFILE', prev.USERPROFILE], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prev.ALLOW]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  rmSync(home, { recursive: true, force: true }); rmSync(projectDir, { recursive: true, force: true });
});

const { MODEL_ROLES, roleOf, roleOfJob, jobSlot, roleOfSettingId } = await import('../src/shared/model-roles.mjs');
const { resolveRoleModel, roleModelFor, withRole, withScanRole } = await import('../src/core/model-roles.mjs');
const { assertModelRolesInput, setModelRoles } = await import('../src/core/settings.mjs');
const { listModels, resolveStepModels } = await import('../src/core/config.mjs');
const { resolveGraph, writeGraphWorkflow } = await import('../src/core/workflows.mjs');
const { loadAgentRegistry } = await import('../src/core/agent-registry.mjs');
const { resolveTitleModel } = await import('../src/core/title.mjs');
const { resolvePrDescriptionModel } = await import('../src/core/pr-description.mjs');
const { resolveAutoModel } = await import('../src/core/auto/model.mjs');
const { defaultAskPrefs } = await import('../src/core/ask/models.mjs');
const { defragSlotPair } = await import('../src/core/settings-cascade.mjs');
const { WORKSPACE_SCAN_DEFAULT_MODELS } = await import('../src/core/graph/builtin-workflows.mjs');
const { createOrchestrator } = await import('../src/core/orchestrator.mjs');
const { getDb, prepare } = await import('../src/core/db.mjs');
const { projectKey } = await import('../src/core/store.mjs');

const settingsPath = join(home, '.worca-cc', 'settings.json');
const writeUser = (obj) => { mkdirSync(join(home, '.worca-cc'), { recursive: true }); writeFileSync(settingsPath, JSON.stringify(obj)); };
const REG = () => loadAgentRegistry(undefined, { userAgentsDir: null });
const nodeOf = (resolved, key) => Object.values(resolved.nodes).find((n) => n.kind === 'agent' && n.authoredKey === key);
const DEEP = { model: 'claude-opus-5-5', effort: 'high' };
const EVERYDAY = { model: 'claude-sonnet-5-5', effort: 'medium' };
const QUICK = { model: 'claude-haiku-5-5', effort: 'low' };

beforeEach(() => {
  writeUser({});
  getDb();
  prepare('DELETE FROM project_config WHERE project_key = ?').run(projectKey(projectDir));
  prepare('DELETE FROM config_workflow_nodes WHERE project_key = ?').run(projectKey(projectDir));
});

test('the model ids this suite uses are in the builtin catalog (gpt-5.5 runs on codex)', async () => {
  const ids = new Map((await listModels('')).map((m) => [m.id, m]));
  for (const id of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'gpt-5.5']) assert.ok(ids.has(id), id);
  assert.ok((await import('../src/shared/connections.mjs')).runsOn(ids.get('gpt-5.5'), 'codex'));
});

// --- the role table ---------------------------------------------------------

test('roleOf: steps by agent key, plugin judgement steps by name', () => {
  assert.equal(roleOf('steps.planner'), 'deep');
  assert.equal(roleOf('steps.implementer'), 'everyday');
  assert.equal(roleOf('steps.clarify'), 'everyday');
  assert.equal(roleOf('steps.memoryDefragmenter'), 'quick');
  assert.equal(roleOf('steps.bugRca', { name: 'Bug Root Cause' }), 'deep');
  assert.deepEqual(MODEL_ROLES, ['deep', 'everyday', 'quick']);
});

test('roleOf: every D4 setting key', () => {
  const table = {
    'nightMode.deciderModel': 'deep',
    askModels: 'everyday', agentGenModel: 'everyday', requirementsInterview: 'everyday', autoWorkflowModel: 'everyday',
    titleModel: 'quick', namingModel: 'quick', commandSummaryModel: 'quick', prDescriptionModel: 'quick',
    memoryDefrag: 'quick', workspaceScan: 'quick', 'utilityModels.overview': 'quick',
  };
  for (const [slot, role] of Object.entries(table)) assert.equal(roleOf(slot), role, slot);
  assert.equal(roleOf('unknownKey'), null);
  assert.equal(roleOf('constructor'), null);
});

test('roleOfJob / jobSlot / roleOfSettingId', () => {
  assert.equal(roleOfJob('claude', 'classifier'), 'everyday');
  assert.equal(roleOfJob('codex', 'classifier'), 'quick');
  assert.equal(roleOfJob('claude', 'title'), 'quick');
  assert.equal(jobSlot('claude', 'title'), 'titleModel');
  assert.equal(jobSlot('codex', 'title'), 'utilityModels.title');
  assert.equal(jobSlot('codex', 'naming'), 'namingModel');
  assert.equal(jobSlot('claude', 'overview'), 'utilityModels.overview');
  assert.equal(roleOfSettingId('models.claude.steps.planner'), 'deep');
  assert.equal(roleOfSettingId('models.codex.utility.classifier'), 'quick');
  assert.equal(roleOfSettingId('models.claude.title'), 'quick');
  assert.equal(roleOfSettingId('models.claude.roles.deep'), null);
});

// --- the resolver -----------------------------------------------------------

test('resolveRoleModel maps the effort to the harness (A7) and type-checks every level (R-sec-3)', () => {
  assert.deepEqual(resolveRoleModel('claude', 'quick', { roles: { claude: { quick: QUICK } } }),
    { model: 'claude-haiku-5-5', effort: 'medium', role: 'quick', source: 'role' });
  for (const roles of ['x', [], { claude: 'x' }, { claude: { deep: { model: 7 } } }]) {
    assert.equal(resolveRoleModel('claude', 'deep', { roles }), null, JSON.stringify(roles));
  }
});

test('withRole: an own pair wins; else the slot role on that engine; else the pair', () => {
  const roles = { claude: { quick: QUICK } };
  const own = { model: 'claude-sonnet-5-5' };
  assert.equal(withRole(own, 'claude', 'titleModel', { roles }), own);
  assert.equal(withRole(null, 'claude', 'titleModel', { roles }).model, 'claude-haiku-5-5');
  assert.equal(withRole(null, 'copilot', 'titleModel', { roles }), null);
  assert.equal(withRole(null, 'claude', 'unknownKey', { roles }), null);
});

test('withScanRole: the quick role is the scan model; the sub-agent alias keeps its default', () => {
  const roles = { claude: { quick: QUICK } };
  const got = withScanRole(null, WORKSPACE_SCAN_DEFAULT_MODELS, { roles });
  assert.equal(got.scanModel, 'claude-haiku-5-5');
  assert.equal(got.scanEffort, 'medium');
  assert.equal(got.agentModel, WORKSPACE_SCAN_DEFAULT_MODELS.agentModel);
  const stored = { scanModel: 'claude-sonnet-5-5', scanEffort: 'high', agentModel: 'sonnet', agentEffort: 'medium' };
  assert.equal(withScanRole(stored, WORKSPACE_SCAN_DEFAULT_MODELS, { roles }), stored);
  assert.equal(withScanRole(null, WORKSPACE_SCAN_DEFAULT_MODELS, { roles: {} }), null);
});

// --- titles (AC-1.1, AC-1.2) ------------------------------------------------

test('titles: the quick role beats the run model; a stored titleModel beats the role', () => {
  const deps = { env: {}, stored: () => '', role: () => 'claude-haiku-5-5', inCatalog: () => true, ready: () => true };
  const r = resolveTitleModel({ runModel: 'claude-opus-5-5' }, deps);
  assert.equal(r.model, 'claude-haiku-5-5'); assert.equal(r.source, 'role');
  const s = resolveTitleModel({ runModel: 'claude-opus-5-5' }, { ...deps, stored: () => 'claude-sonnet-5-5' });
  assert.equal(s.model, 'claude-sonnet-5-5'); assert.equal(s.source, 'settings');
});

test('titles: the real settings path reads modelRoles.claude.quick', () => {
  writeUser({ modelRoles: { claude: { quick: QUICK } } });
  const r = resolveTitleModel({ runModel: 'claude-opus-5-5' }, { env: {} });
  assert.equal(r.model, 'claude-haiku-5-5'); assert.equal(r.source, 'role');
});

// --- steps (AC-1.3) ---------------------------------------------------------

test('resolveStepModels: planner takes deep, implementer everyday; a run model beats both', async () => {
  writeUser({ modelRoles: { claude: { deep: DEEP, everyday: EVERYDAY } } });
  const out = await resolveStepModels(projectDir, undefined, 'claude');
  assert.deepEqual(out.planner, { model: 'claude-opus-5-5', effort: 'high' });
  assert.deepEqual(out.implementer, { model: 'claude-sonnet-5-5', effort: 'medium' });
  const run = await resolveStepModels(projectDir, 'claude-haiku-5-5', 'claude');
  assert.deepEqual(run.planner, { model: 'claude-haiku-5-5', effort: undefined });
  assert.deepEqual(run.implementer, { model: 'claude-haiku-5-5', effort: undefined });
});

test('resolveGraph: the role is the last layer; a run model, an Auto run and a step slot skip it', async () => {
  writeUser({ modelRoles: { claude: { deep: DEEP, everyday: EVERYDAY } } });
  const plain = await resolveGraph(projectDir, 'wf_default', REG());
  assert.equal(nodeOf(plain, 'planner').model, 'claude-opus-5-5');
  assert.equal(nodeOf(plain, 'planner').effort, 'high');
  assert.equal(nodeOf(plain, 'implementer').model, 'claude-sonnet-5-5');
  const run = await resolveGraph(projectDir, 'wf_default', REG(), undefined, { runModel: 'claude-haiku-5-5' });
  assert.equal(nodeOf(run, 'planner').model, undefined);
  const auto = await resolveGraph(projectDir, 'wf_default', REG(), undefined, { ignoreProjectOverrides: true });
  assert.equal(nodeOf(auto, 'planner').model, undefined);
  writeUser({ modelRoles: { claude: { deep: DEEP } }, stepModels: { claude: { planner: { model: 'claude-sonnet-5-5' } } } });
  const slot = await resolveGraph(projectDir, 'wf_default', REG());
  assert.equal(nodeOf(slot, 'planner').model, 'claude-sonnet-5-5');
});

test('resolveGraph: a template model beats the role (A10)', async () => {
  writeUser({ modelRoles: { claude: { deep: DEEP } } });
  await writeGraphWorkflow({
    id: 'wf_roles_tpl', name: 'Roles tpl', domain: 'coding',
    nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: { model: 'claude-sonnet-5-5' } },
      { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
    wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
      { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_end', port: 'result' } }],
  });
  const got = await resolveGraph(projectDir, 'wf_roles_tpl', REG());
  assert.equal(got.nodes.n_plan.model, 'claude-sonnet-5-5');
});

// --- helper call sites (A12–A14) -------------------------------------------

test('helper resolvers take their D4 role when their own slot is unset', async () => {
  const roles = { claude: { deep: DEEP, everyday: EVERYDAY, quick: { model: 'claude-haiku-5-5' } } };
  writeUser({ modelRoles: roles });
  const models = await listModels('');
  assert.equal(resolvePrDescriptionModel(models).model, 'claude-haiku-5-5');
  assert.equal(resolveAutoModel(models, { env: {} }), 'claude-sonnet-5-5');
  assert.deepEqual({ model: defaultAskPrefs().slots.claude.model, effort: defaultAskPrefs().slots.claude.effort }, EVERYDAY);
  assert.equal(withRole(defragSlotPair('claude'), 'claude', 'memoryDefrag').model, 'claude-haiku-5-5');
  assert.equal(roleModelFor('claude', 'nightMode.deciderModel').model, 'claude-opus-5-5');
  writeUser({ modelRoles: roles, prDescriptionModel: 'claude-sonnet-5-5', askModels: { claude: { model: 'claude-opus-5-5', effort: 'max' } } });
  assert.equal(resolvePrDescriptionModel(models).model, 'claude-sonnet-5-5');
  assert.deepEqual({ model: defaultAskPrefs().slots.claude.model, effort: defaultAskPrefs().slots.claude.effort }, { model: 'claude-opus-5-5', effort: 'max' });
  writeUser({ modelRoles: { codex: { quick: { model: 'gpt-5.5' } } } });
  assert.equal(resolveAutoModel(models, { env: {}, engine: 'codex' }), 'gpt-5.5');
});

test('the Away decider takes the deep role; a stored decider wins', async () => {
  writeUser({ modelRoles: { claude: { deep: DEEP } } });
  const orch = createOrchestrator({ projectDir: '/tmp/roles-decider', claude: {} });
  const pair = await orch._nightDeciderPair({});
  assert.equal(pair.model, 'claude-opus-5-5'); assert.equal(pair.effort, 'high');
  const own = await orch._nightDeciderPair({ deciderModel: 'claude-sonnet-5-5', deciderEffort: 'low' });
  assert.equal(own.model, 'claude-sonnet-5-5');
  assert.notEqual(own.effort, 'high');
});

// --- no modelRoles (AC-1.4) -------------------------------------------------

test('with no modelRoles every slot resolves as today', async () => {
  writeUser({ stepModels: { claude: { reviewer: { model: 'claude-sonnet-5-5' } } }, titleModel: 'claude-haiku-5-5' });
  const out = await resolveStepModels(projectDir, undefined, 'claude');
  assert.equal(out.reviewer.model, 'claude-sonnet-5-5');
  assert.equal(out.planner.model, undefined); assert.equal(out.implementer.model, undefined);
  const g = await resolveGraph(projectDir, 'wf_default', REG());
  assert.equal(nodeOf(g, 'planner').model, undefined);
  assert.equal(nodeOf(g, 'reviewer').model, 'claude-sonnet-5-5');
  for (const r of MODEL_ROLES) assert.equal(resolveRoleModel('claude', r), null);
  assert.equal(withRole(null, 'claude', 'titleModel'), null);
});

// --- harness isolation (AC-1.6) ---------------------------------------------

test('modelRoles.codex applies only to Codex', async () => {
  writeUser({ modelRoles: { codex: { everyday: { model: 'gpt-5.5' } } } });
  for (const r of MODEL_ROLES) assert.equal(resolveRoleModel('claude', r), null);
  assert.equal((await resolveStepModels(projectDir, undefined, 'claude')).implementer.model, undefined);
  assert.equal(nodeOf(await resolveGraph(projectDir, 'wf_default', REG()), 'implementer').model, undefined);
  assert.notEqual(resolveTitleModel({}, { env: {} }).source, 'role');
  assert.equal(withRole(null, 'claude', 'askModels'), null);
  assert.equal((await resolveStepModels(projectDir, undefined, 'codex')).implementer.model, 'gpt-5.5');
  writeUser({ modelRoles: { codex: { everyday: { model: 'claude-opus-5-5' } } } });
  assert.equal((await resolveStepModels(projectDir, undefined, 'codex')).implementer.model, undefined);
  const codex = await resolveGraph(projectDir, 'wf_default', REG(), undefined, { engine: 'codex' });
  assert.equal(nodeOf(codex, 'implementer').model, undefined);
});

// --- validation and writes --------------------------------------------------

test('assertModelRolesInput refuses unknown roles and a role without a model', () => {
  assert.throws(() => assertModelRolesInput({ claude: { fast: { model: 'x' } } }), /unknown role "fast"/);
  assert.throws(() => assertModelRolesInput({ claude: { deep: { effort: 'high' } } }), /modelRoles\.claude\.deep\.model is required/);
  assert.throws(() => assertModelRolesInput({ claude: { deep: { model: 'claude-opus-5-5', effort: 'rm -rf' } } }), /modelRoles\.claude\.deep\.effort/);
});

test('setModelRoles merges, returns what it wrote, and drops the key when empty', async () => {
  assert.deepEqual(await setModelRoles({ claude: { quick: { model: 'claude-haiku-5-5' } } }),
    { modelRoles: { claude: { quick: { model: 'claude-haiku-5-5' } } } });
  await setModelRoles({ claude: { quick: null } });
  assert.ok(existsSync(settingsPath));
  assert.equal(Object.hasOwn(JSON.parse(readFileSync(settingsPath, 'utf8')), 'modelRoles'), false);
});

const { upstreamKey, mapUpstreamModel, projectRoles, shareUpstream, NO_SOURCE_LINE } = await import('../src/core/model-roles.mjs');

const OPUS_BUILTIN = { id: 'claude-opus-5-5', engine: 'claude', harnesses: ['claude'] };
const COPILOT_OPUS = { id: 'copilot-claude-opus-5-5', custom: 'global', bridged: 'copilot', upstreamModel: 'claude-opus-5.5', harnesses: ['claude'] };
const OR_OPUS = { id: 'or-anthropic-claude-opus-5-5', custom: 'global', bridged: 'openai', upstreamModel: 'anthropic/claude-opus-5.5', harnesses: ['claude'] };

test('upstreamKey: dots, vendor prefix, [1m] and date suffix compare equal', () => {
  for (const id of ['claude-opus-5.5', 'anthropic/claude-opus-5.5', 'Claude-Opus-5-5[1m]', 'claude-opus-5-5-20261001']) assert.equal(upstreamKey(id), 'claude-opus-5-5', id);
});

test('AC-5.3: on a Copilot-only machine claude-opus-5-5 resolves to the Copilot import', () => {
  const hit = mapUpstreamModel('claude-opus-5-5', 'claude', { catalog: [OPUS_BUILTIN, COPILOT_OPUS], claudeAuth: 'signed-out' });
  assert.deepEqual(hit, { id: 'copilot-claude-opus-5-5', source: 'copilot' });
});

test('AC-5.3: no entry serves it → "None of your sources offer it."', () => {
  const miss = mapUpstreamModel('claude-opus-5-5', 'claude', { catalog: [OPUS_BUILTIN, { ...COPILOT_OPUS, needsSignIn: true }], claudeAuth: 'signed-out' });
  assert.deepEqual(miss, { id: null, line: NO_SOURCE_LINE });
  assert.match(NO_SOURCE_LINE, /none of your sources offer it/i);
  assert.deepEqual(mapUpstreamModel('claude-opus-5-5', 'claude', { catalog: [] }), { id: null, line: NO_SOURCE_LINE });
});

test('mapping never picks a team policy, plugin or project row (a team artifact cannot add a source)', () => {
  for (const custom of ['policy', 'plugin', 'project']) {
    const row = { ...COPILOT_OPUS, id: `x-${custom}`, custom };
    assert.deepEqual(mapUpstreamModel('claude-opus-5-5', 'claude', { catalog: [row], claudeAuth: 'signed-out' }), { id: null, line: NO_SOURCE_LINE }, custom);
    assert.deepEqual(mapUpstreamModel('claude-opus-5-5', 'claude', { catalog: [{ id: 'claude-opus-5-5', custom, harnesses: ['claude'] }], claudeAuth: 'signed-in' }), { id: null, line: NO_SOURCE_LINE }, custom);
  }
});

test('mapping ranks the Claude sign-in, then Copilot, then API-key entries, then an unknown sign-in', () => {
  const catalog = [OR_OPUS, COPILOT_OPUS, OPUS_BUILTIN];
  assert.equal(mapUpstreamModel('claude-opus-5-5', 'claude', { catalog, claudeAuth: 'signed-in' }).id, 'claude-opus-5-5');
  assert.equal(mapUpstreamModel('claude-opus-5-5', 'claude', { catalog: [OR_OPUS, OPUS_BUILTIN], claudeAuth: 'signed-out' }).id, 'or-anthropic-claude-opus-5-5');
  assert.equal(mapUpstreamModel('claude-opus-5-5', 'claude', { catalog: [OPUS_BUILTIN], claudeAuth: 'unknown' }).id, 'claude-opus-5-5');
  assert.equal(mapUpstreamModel('claude-opus-5-5', 'codex', { catalog }).id, null);   // no entry runs on codex
});

test('projectRoles: default fills only unset roles; soft wins; unmapped roles are reported', () => {
  const team = (kind) => ({ kind, value: { claude: { deep: { model: 'claude-opus-5-5', effort: 'high' }, quick: { model: 'gpt-9' } } } });
  const user = { claude: { deep: { model: 'mine' } } };
  const d = projectRoles('claude', { user, team: team('default'), catalog: [COPILOT_OPUS], claudeAuth: 'signed-out' });
  assert.deepEqual(d.roles.claude.deep, { model: 'mine' });
  assert.deepEqual(d.unmapped, [{ role: 'quick', upstream: 'gpt-9', line: NO_SOURCE_LINE }]);
  const s = projectRoles('claude', { user, team: team('soft'), catalog: [COPILOT_OPUS], claudeAuth: 'signed-out' });
  assert.deepEqual(s.roles.claude.deep, { model: 'copilot-claude-opus-5-5', effort: 'high' });
});

test('shareUpstream: a Copilot or OpenRouter entry shares the built-in id; anything else is not shared', () => {
  const catalog = [OPUS_BUILTIN, COPILOT_OPUS, OR_OPUS, { id: 'my-local-model', custom: 'global', harnesses: ['claude'] }];
  assert.equal(shareUpstream('copilot-claude-opus-5-5', catalog), 'claude-opus-5-5');
  assert.equal(shareUpstream('or-anthropic-claude-opus-5-5', catalog), 'claude-opus-5-5');
  assert.equal(shareUpstream('claude-opus-5-5', catalog), 'claude-opus-5-5');
  assert.equal(shareUpstream('my-local-model', catalog), null);        // a custom id never leaves the machine
  assert.equal(shareUpstream('not-in-catalog', catalog), null);
});

test('AC-5.2: a project policy models.roles reaches step models without writing settings.json', async () => {
  const { addProject } = await import('../src/core/projects.mjs');
  const { writeTeamPolicyPrefs, _resetRoleAuthForTests } = await import('../src/core/config.mjs');
  _resetRoleAuthForTests();
  const proj = mkdtempSync(join(tmpdir(), 'worca-roles-team-'));
  await addProject({ name: 'roles-team', path: proj });
  writeTeamPolicyPrefs(projectKey(proj), { present: true, hasOrigin: true, docKnown: true, slug: 'acme/gateway', headSha: 'abc1234', delegateTo: null,
    unknownSchema: false, warnings: [], checkedAt: new Date().toISOString(),
    doc: { schema: 1, fields: { 'models.roles': { kind: 'default', value: { claude: { deep: { model: 'claude-opus-5-5', effort: 'high' } } } } }, workspaceRuns: {}, catalogs: { guardrailSets: [], models: [] } } });
  const before = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : null;
  const prevMock = process.env.WORCA_MOCK; process.env.WORCA_MOCK = '1';
  try {
    const steps = await resolveStepModels(proj, null, 'claude');
    assert.equal(steps.planner.model, 'claude-opus-5-5');
    assert.equal(steps.planner.effort, 'high');
    // The workflow graph's roleFor takes the same team roles (R-arch-3).
    _resetRoleAuthForTests();
    const g = await resolveGraph(proj, 'wf_default', REG());
    assert.equal(nodeOf(g, 'planner').model, 'claude-opus-5-5');
    assert.equal(nodeOf(g, 'planner').effort, 'high');
  } finally { if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock; _resetRoleAuthForTests(); rmSync(proj, { recursive: true, force: true }); }
  assert.equal(existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : null, before);
});

test('projectRolesFor: a signed-out Claude login skips the built-in; a refused team value is dropped', async () => {
  const { projectRolesFor, _resetRoleAuthForTests } = await import('../src/core/config.mjs');
  _resetRoleAuthForTests();
  const team = { kind: 'default', value: { claude: { deep: { model: 'claude-opus-5-5' } } } };
  const out = await projectRolesFor('claude', null, { user: {}, team, catalog: [OPUS_BUILTIN], claudeAuth: 'signed-out' });
  assert.equal(out.roles.claude.deep, undefined);
  assert.deepEqual(out.unmapped, [{ role: 'deep', upstream: 'claude-opus-5-5', line: NO_SOURCE_LINE }]);
  // A value checkTeamSetup refuses (a secret-looking model id) never reaches a run (security-2-2).
  const bad = { kind: 'default', value: { claude: { deep: { model: 'sk-ant-abcdefghijklmnopqrst' } } } };
  const logs = [];
  const r = await projectRolesFor('claude', null, { user: {}, team: bad, catalog: [OPUS_BUILTIN], claudeAuth: 'signed-in', log: (s) => logs.push(s) });
  assert.deepEqual(r, { roles: {}, unmapped: [] });
  assert.equal(logs.length, 1);
  assert.doesNotMatch(logs[0], /sk-ant-/);
  _resetRoleAuthForTests();
});
