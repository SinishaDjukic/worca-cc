// test/workflows-resolve-graph-factory.test.mjs — resolveGraph's factory model layer (src/core/factory-models.mjs): the
// built-in graphs pin no model, the factory defaults sit at the template's old position, a factory default that needs
// the Claude Code sign-in is dropped while signed out (with a note), and a user-set one is listed in `signInBlocked`.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { resolveGraph, writeGraphWorkflow, readWorkflow } from '../src/core/workflows.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { addGlobalModel, removeGlobalModel } from '../src/core/settings.mjs';
import { setNodeModel } from '../src/core/config.mjs';
import { SHAPE_REQ_WORKFLOW_ID, WORKSPACE_SCAN_DEFAULT_MODELS } from '../src/core/graph/builtin-workflows.mjs';

useTempHome(after);
const prev = {};
let home;
let reg;
const KEYS = ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK'];
const GW = 'gw-s46';
before(async () => {
  home = mkdtempSync(join(tmpdir(), 'worca-factory-home-'));
  for (const k of KEYS) prev[k] = process.env[k];
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  writeUser({});
  await addGlobalModel({ id: GW, label: 'Copilot Claude Sonnet 4.6', efforts: ['medium', 'high', 'xhigh'], env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' } });
  await addGlobalModel({ id: 'gw-one', label: 'Gateway one-effort', efforts: ['medium'], env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' } });
  reg = loadAgentRegistry();
});
after(() => {
  for (const k of KEYS) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  rmSync(home, { recursive: true, force: true });
});
/** The user settings file, keeping the routed catalog entries addGlobalModel stored (`models`). */
function writeUser(obj) {
  mkdirSync(join(home, '.worca-cc'), { recursive: true });
  const file = join(home, '.worca-cc', 'settings.json');
  const models = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).models : undefined;
  writeFileSync(file, JSON.stringify({ ...(models ? { models } : {}), ...obj }));
}
beforeEach(() => writeUser({}));

const ROLES_COPILOT = { modelRoles: { claude: { deep: { model: GW, effort: 'medium' }, everyday: { model: GW, effort: 'medium' }, quick: { model: GW } } } };
const auth = (state) => { const fn = async () => { fn.calls += 1; return { state, source: 'cli', detail: null }; }; fn.calls = 0; return fn; };
const pairOf = (nc) => [nc.model, nc.effort];
const resolve = (wf, opts = {}, dir = gitDir('factory')) => resolveGraph(dir, wf, reg, undefined, opts);

test('signed in, no settings: Shaper, Shaper requirements, defrag and scan resolve to today\'s values', async () => {
  const signedIn = auth('signed-in');
  const shape = await resolve('wf_shape', { claudeAuth: signedIn });
  assert.deepEqual(pairOf(shape.nodes.n_roles), ['claude-sonnet-5-5', 'medium']);
  assert.deepEqual(shape.nodes.n_roles.roles, { product: { model: 'claude-opus-5-5', effort: 'medium', source: 'template' } });
  assert.equal(shape.nodes.n_roles.wanted, undefined);
  const req = await resolve(SHAPE_REQ_WORKFLOW_ID, { claudeAuth: signedIn });
  assert.deepEqual(pairOf(req.nodes.n_reqroles), ['claude-sonnet-5-5', 'medium']);
  const defrag = await resolve('wf_memory_defrag', { claudeAuth: signedIn });
  assert.deepEqual(pairOf(defrag.nodes.n_defrag), ['claude-sonnet-5', undefined]);
  const scan = await resolve('wf_workspace_scan', { claudeAuth: signedIn, isWorkspace: true });
  for (const id of ['n_scan', 'n_usage']) {
    const nc = scan.nodes[id];
    assert.deepEqual([nc.model, nc.effort, nc.subagentModel, nc.subagentEffort], [WORKSPACE_SCAN_DEFAULT_MODELS.scanModel, 'medium', 'sonnet', 'medium'], id);
  }
  assert.deepEqual(pairOf(scan.nodes.n_synth), ['claude-sonnet-5', 'medium']);
  assert.equal(shape.factoryNotes, undefined);
  assert.equal(shape.signInBlocked, undefined);
  assert.deepEqual(shape.nodes, (await resolve('wf_shape')).nodes, 'identical to the unprobed resolve');
});

test('auth unknown / no claudeAuth: no probe, identical result keys and nodes', async () => {
  writeUser(ROLES_COPILOT);
  const unknown = auth('unknown');
  const a = await resolve('wf_shape', { claudeAuth: unknown });
  const b = await resolve('wf_shape');
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
  assert.deepEqual(a.nodes, b.nodes);
  assert.equal('factoryNotes' in a || 'signInBlocked' in a, false);
  assert.ok(unknown.calls <= 1);
  assert.deepEqual(pairOf(b.nodes.n_roles), ['claude-sonnet-5-5', 'medium'], 'the factory beats the Deep role');
});

test('signed out, Copilot roles: n_roles and n_reqroles take the roles, Product varies the effort, one note per setting', async () => {
  writeUser(ROLES_COPILOT);
  const out = auth('signed-out');
  const r = await resolve('wf_shape', { claudeAuth: out });
  const nc = r.nodes.n_roles;
  assert.deepEqual(pairOf(nc), [GW, 'medium']);
  assert.deepEqual(nc.wanted, { model: 'claude-sonnet-5-5', effort: 'medium', source: 'default' });
  assert.deepEqual(nc.roles.product, { effort: 'high', source: 'default', wanted: { model: 'claude-opus-5-5', effort: 'medium' } });
  assert.deepEqual(r.factoryNotes.map((n) => [n.setting, n.nodeId, n.role || null]), [['steps.planReviewer', 'n_roles', null], ['secondOpinion', 'n_roles', 'product']]);
  assert.deepEqual(r.factoryNotes[0].used, { model: GW, effort: 'medium' });
  assert.deepEqual(r.factoryNotes[1].used, { model: GW, effort: 'high' });
  assert.equal(r.signInBlocked, undefined, 'routed role models need no sign-in');
  assert.equal(out.calls, 1, 'one probe for many candidates');
  const req = await resolve(SHAPE_REQ_WORKFLOW_ID, { claudeAuth: auth('signed-out') });
  assert.deepEqual(pairOf(req.nodes.n_reqroles), [GW, 'medium']);
  assert.deepEqual(req.factoryNotes.map((n) => n.setting).sort(), ['secondOpinion', 'steps.planReviewer', 'steps.requirementsReviewer'], 'it holds the plan review too');
});

test('signed out, no role: the defrag node names no model and records the factory as wanted', async () => {
  const r = await resolve('wf_memory_defrag', { claudeAuth: auth('signed-out') });
  assert.equal(r.nodes.n_defrag.model, undefined);
  assert.deepEqual(r.nodes.n_defrag.wanted, { model: 'claude-sonnet-5', source: 'default' });
  assert.deepEqual(r.factoryNotes, [{ setting: 'memoryDefrag', nodeId: 'n_defrag', wanted: { model: 'claude-sonnet-5' }, used: { model: null, effort: null } }]);
  assert.equal(r.signInBlocked, undefined);
});

test('signed out, a routed factory model is never dropped', async () => {
  await addGlobalModel({ id: 'claude-sonnet-5', label: 'Sonnet 5 (gateway)', efforts: ['medium'], env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' } });
  try {
    const out = auth('signed-out');
    const r = await resolve('wf_memory_defrag', { claudeAuth: out });
    assert.equal(r.nodes.n_defrag.model, 'claude-sonnet-5');
    assert.equal(r.factoryNotes, undefined);
    assert.equal(out.calls, 0, 'no candidate needs the sign-in: no probe');
  } finally { await removeGlobalModel('claude-sonnet-5'); }
});

test('signed out, a model whose own catalog env signs the CLI in: no factory drop and no refusal', async () => {
  const bedrock = { CLAUDE_CODE_USE_BEDROCK: '1', AWS_PROFILE: 'x' };
  await addGlobalModel({ id: 'claude-sonnet-5', label: 'Sonnet 5 (key)', efforts: ['medium'], env: { ANTHROPIC_API_KEY: 'sk-test' } });
  await addGlobalModel({ id: 'claude-opus-5-5', label: 'Opus 5.5 (Bedrock)', efforts: ['medium', 'high'], env: bedrock });
  try {
    const out = auth('signed-out');
    const defrag = await resolve('wf_memory_defrag', { claudeAuth: out });
    assert.equal(defrag.nodes.n_defrag.model, 'claude-sonnet-5');
    assert.equal(defrag.factoryNotes, undefined);
    assert.equal(defrag.signInBlocked, undefined);
    assert.equal(out.calls, 0, 'no candidate needs the sign-in: no probe');
    writeUser({ stepModels: { claude: { planReviewer: { model: 'claude-opus-5-5' } } } });
    const shape = await resolve('wf_shape', { claudeAuth: out });
    assert.equal(shape.nodes.n_roles.model, 'claude-opus-5-5');
    assert.equal(shape.nodes.n_roles.roles.product.model, 'claude-opus-5-5', 'the second opinion keeps its factory default too');
    assert.equal(shape.signInBlocked, undefined);
  } finally {
    await removeGlobalModel('claude-sonnet-5');
    await removeGlobalModel('claude-opus-5-5');
  }
});

test('signed out, a catalog env that signs nothing in still needs the sign-in: an unset ${VAR} key, a switched-off cloud flag', async () => {
  delete process.env.WORCA_TEST_UNSET_KEY;
  await addGlobalModel({ id: 'claude-sonnet-5', label: 'Sonnet 5 (no key)', efforts: ['medium'], env: { ANTHROPIC_API_KEY: '${WORCA_TEST_UNSET_KEY}' } });
  await addGlobalModel({ id: 'claude-opus-5-5', label: 'Opus 5.5 (flag off)', efforts: ['medium'], env: { CLAUDE_CODE_USE_BEDROCK: '0' } });
  try {
    const defrag = await resolve('wf_memory_defrag', { claudeAuth: auth('signed-out') });
    assert.equal(defrag.nodes.n_defrag.model, undefined);
    assert.deepEqual(defrag.factoryNotes.map((n) => n.setting), ['memoryDefrag']);
    writeUser({ stepModels: { claude: { planReviewer: { model: 'claude-opus-5-5' } } } });
    const shape = await resolve('wf_shape', { claudeAuth: auth('signed-out') });
    assert.deepEqual(shape.signInBlocked.map((b) => [b.model, b.source]), [['claude-opus-5-5', 'slot']]);
  } finally {
    await removeGlobalModel('claude-sonnet-5');
    await removeGlobalModel('claude-opus-5-5');
  }
});

test('second opinion falls back with a 1-effort model: no effort, wanted recorded', async () => {
  writeUser({ modelRoles: { claude: { deep: { model: 'gw-one', effort: 'medium' } } } });
  const r = await resolve('wf_shape', { claudeAuth: auth('signed-out') });
  assert.deepEqual(pairOf(r.nodes.n_roles), ['gw-one', 'medium']);
  assert.deepEqual(r.nodes.n_roles.roles.product, { source: 'default', wanted: { model: 'claude-opus-5-5', effort: 'medium' } });
  assert.deepEqual(r.factoryNotes[1].used, { model: 'gw-one', effort: null });
});

test('precedence: run overlay > project node pick > user step slot > factory; overlay and project role picks > helper job > factory', async () => {
  const dir = gitDir('factory-prec');
  writeUser({ stepModels: { claude: { planReviewer: { model: 'claude-haiku-4-5' } } }, secondOpinionModel: { model: 'claude-sonnet-5', effort: 'high' } });
  let r = await resolve('wf_shape', {}, dir);
  assert.equal(r.nodes.n_roles.model, 'claude-haiku-4-5', 'the user step slot beats the factory');
  assert.deepEqual(r.nodes.n_roles.roles.product, { model: 'claude-sonnet-5', effort: 'high', source: 'slot' }, 'the helper job beats the factory');
  await setNodeModel(dir, 'wf_shape', 'n_roles', { model: 'claude-opus-5-5', effort: 'high', roles: { product: { model: 'claude-haiku-4-5' } } });
  r = await resolve('wf_shape', {}, dir);
  assert.deepEqual(pairOf(r.nodes.n_roles), ['claude-opus-5-5', 'high'], 'the project node pick beats the slot');
  assert.deepEqual(r.nodes.n_roles.roles.product, { model: 'claude-haiku-4-5', source: 'project' });
  r = await resolve('wf_shape', { overlay: { nodes: { n_roles: { model: 'claude-sonnet-5', effort: '', roles: { product: { model: 'claude-opus-5-5' } } } } } }, dir);
  assert.equal(r.nodes.n_roles.model, 'claude-sonnet-5', 'the run overlay beats the project');
  assert.deepEqual(r.nodes.n_roles.roles.product, { model: 'claude-opus-5-5', source: 'run' });
  writeUser({ modelRoles: { claude: { deep: { model: 'claude-haiku-4-5' } } } });
  r = await resolve('wf_shape');
  assert.equal(r.nodes.n_roles.model, 'claude-sonnet-5-5', 'the factory beats the Deep role');
});

test('user-set Second-opinion reviewer beats the factory and needs no factory note', async () => {
  writeUser({ ...ROLES_COPILOT, secondOpinionModel: { model: 'gw-one' } });
  const r = await resolve('wf_shape', { claudeAuth: auth('signed-out') });
  assert.deepEqual(r.nodes.n_roles.roles.product, { model: 'gw-one', source: 'slot' });
  assert.deepEqual(r.factoryNotes.map((n) => n.setting), ['steps.planReviewer']);
});

test('user-set sign-in step model while signed out: kept, listed in signInBlocked with source slot', async () => {
  writeUser({ ...ROLES_COPILOT, stepModels: { claude: { planReviewer: { model: 'claude-opus-5-5' } } }, secondOpinionModel: { model: 'claude-opus-5-5' } });
  const r = await resolve('wf_shape', { claudeAuth: auth('signed-out') });
  assert.equal(r.nodes.n_roles.model, 'claude-opus-5-5', 'a user value is never replaced');
  assert.deepEqual(r.signInBlocked, [
    { nodeId: 'n_roles', node: 'Plan Review', model: 'claude-opus-5-5', source: 'slot' },
    { nodeId: 'n_roles', node: 'Plan Review', role: 'Product', model: 'claude-opus-5-5', source: 'slot' },
  ]);
  assert.equal(r.factoryNotes, undefined);
  const signedIn = await resolve('wf_shape', { claudeAuth: auth('signed-in') });
  assert.equal(signedIn.signInBlocked, undefined);
});

test('codex: identical nodes, wanted source template, zero probe calls', async () => {
  writeUser(ROLES_COPILOT);
  const out = auth('signed-out');
  const r = await resolve('wf_shape', { engine: 'codex', claudeAuth: out });
  assert.equal(out.calls, 0);
  assert.deepEqual(r.nodes, (await resolve('wf_shape', { engine: 'codex' })).nodes);
  assert.deepEqual(r.nodes.n_roles.wanted, { model: 'claude-sonnet-5-5', effort: 'medium', source: 'template' });
  assert.deepEqual(r.nodes.n_roles.roles.product, { source: 'template', wanted: { model: 'claude-opus-5-5', effort: 'medium' } });
  assert.equal(r.factoryNotes, undefined);
  assert.equal(r.signInBlocked, undefined);
});

test('a saved copy of Shaper on Codex: the factory drop is recorded with source default', async () => {
  const shape = await readWorkflow('wf_shape');
  const saved = await writeGraphWorkflow({ ...structuredClone(shape), id: undefined, name: 'My shaper copy', domain: 'coding' });
  const r = await resolve(saved.id, { engine: 'codex' });
  assert.deepEqual(r.nodes.n_roles.wanted, { model: 'claude-sonnet-5-5', effort: 'medium', source: 'default' });
  assert.deepEqual(r.nodes.n_roles.roles.product, { source: 'default', wanted: { model: 'claude-opus-5-5', effort: 'medium' } }, 'the second opinion\'s factory default too');
});

test('the emitted config is the authored config', async () => {
  const r = await resolve('wf_workspace_scan', { isWorkspace: true });
  for (const id of ['n_scan', 'n_usage', 'n_synth']) assert.deepEqual(r.nodes[id].config, {}, id);
  const s = await resolve('wf_shape');
  assert.equal('model' in s.nodes.n_roles.config, false);
  assert.equal(s.nodes.n_roles.config.roleReview.secondOpinion, 'product');
  assert.equal('model' in s.nodes.n_roles.config.roleReview.roles.find((x) => x.key === 'product'), false);
});
