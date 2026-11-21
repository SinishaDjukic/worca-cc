// test/workflows-resolve-graph-care.test.mjs — resolveGraph's role fill layer (opts.roleFill, Shaper small runs B2 D11/D12):
// a generic engine capability that fills the model of every node no set layer names, from the role a map points at. Care
// (Shaper) only declares the map (careModelRoles). A run, project, legacy or slot model always wins; a fill never enters
// signInBlocked and never raises a factory note for a node it wins.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { resolveGraph, writeGraphWorkflow } from '../src/core/workflows.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { addGlobalModel } from '../src/core/settings.mjs';
import { setNodeModel } from '../src/core/config.mjs';
import { RESERVED_WORKFLOW_IDS, SHAPE_REQ_WORKFLOW_IDS, SHAPE_SLICE_REQ_WORKFLOW_IDS } from '../src/core/graph/builtin-workflows.mjs';
import { readWorkflow } from '../src/core/workflows.mjs';
import { resolveSessions } from '../src/shared/graph/sessions.mjs';
import { careModelRoles } from '../src/shared/shape/feature-record.mjs';

useTempHome(after);
const prev = {};
let home;
let reg;
const KEYS = ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK'];
const GW = 'gw-care';
before(async () => {
  home = mkdtempSync(join(tmpdir(), 'worca-care-home-'));
  for (const k of KEYS) prev[k] = process.env[k];
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  writeUser({});
  await addGlobalModel({ id: GW, label: 'Routed gateway', efforts: ['medium', 'high'], env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' } });
  reg = loadAgentRegistry();
});
after(() => {
  for (const k of KEYS) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  rmSync(home, { recursive: true, force: true });
});
function writeUser(obj) {
  mkdirSync(join(home, '.worca-cc'), { recursive: true });
  const file = join(home, '.worca-cc', 'settings.json');
  const models = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).models : undefined;
  writeFileSync(file, JSON.stringify({ ...(models ? { models } : {}), ...obj }));
}
beforeEach(() => writeUser({}));

// Fixture A's install roles: the everyday and deep models are read back from here, never hard-coded in the assertions.
const ROLES = { deep: { model: 'claude-sonnet-5' }, everyday: { model: 'claude-haiku-4-5' }, quick: { model: 'claude-haiku-4-5' } };
const EVERYDAY = ROLES.everyday.model;
const DEEP = ROLES.deep.model;
const fill = (position) => ({ roleFill: { source: 'care', roles: careModelRoles(position) } });
const resolve = (wf, opts = {}, dir = gitDir('care')) => resolveGraph(dir, wf, reg, undefined, opts);
const agents = (r) => Object.values(r.nodes).filter((n) => n.kind === 'agent');
const auth = (state) => async () => ({ state, source: 'cli', detail: null });

test('fixture A: Lean fills every Default agent with the everyday model; Balanced keeps deep and everyday; nothing kept', async () => {
  writeUser({ modelRoles: { claude: ROLES } });
  const lean = await resolve('wf_shape', fill('lean'));
  for (const nc of agents(lean)) assert.equal(nc.model, EVERYDAY, nc.nodeId);
  assert.deepEqual(lean.fillNotes.kept, { run: [], project: [], slot: [] });
  assert.deepEqual(lean.fillNotes.filled.sort(), ['n_plan', 'n_refine', 'n_review', 'n_roles'], 'the everyday nodes already resolve to the everyday model');
  assert.equal(lean.fillNotes.source, 'care');
  const balanced = await resolve('wf_shape', fill('balanced'));
  assert.equal(balanced.nodes.n_plan.model, DEEP);
  assert.equal(balanced.nodes.n_review.model, DEEP);
  assert.equal(balanced.nodes.n_impl.model, EVERYDAY);
  assert.deepEqual(balanced.fillNotes, { source: 'care', filled: [], kept: { run: [], project: [], slot: [] } },
    'a fill equal to the resolved model keeps its source and is not listed');
  assert.deepEqual(balanced.nodes, (await resolve('wf_shape')).nodes, 'an identity map changes nothing');
});

test('fixture B: run, project and slot models are kept, and fillNotes.kept lists each source', async () => {
  const dir = gitDir('care-b');
  writeUser({ modelRoles: { claude: ROLES }, stepModels: { claude: { implementer: { model: GW } } } });
  for (const id of ['n_clarify', 'n_plan', 'n_refine']) await setNodeModel(dir, 'wf_shape', id, { model: 'claude-opus-5-5' });
  const r = await resolve('wf_shape', { ...fill('lean'), overlay: { nodes: { n_roles: { model: 'claude-opus-5', effort: '' } } } }, dir);
  for (const id of ['n_clarify', 'n_plan', 'n_refine']) assert.equal(r.nodes[id].model, 'claude-opus-5-5', id);
  assert.equal(r.nodes.n_roles.model, 'claude-opus-5');
  assert.equal(r.nodes.n_impl.model, GW);
  assert.equal(r.nodes.n_review.model, EVERYDAY, 'the one Default agent is filled');
  assert.deepEqual(r.fillNotes, { source: 'care', filled: ['n_review'], kept: { run: ['n_roles'], project: ['n_clarify', 'n_plan', 'n_refine'], slot: ['n_impl'] } });
});

test('a runModel disables the fill and counts every agent as run', async () => {
  writeUser({ modelRoles: { claude: ROLES } });
  const r = await resolve('wf_shape', { ...fill('lean'), runModel: 'claude-opus-5-5' });
  assert.equal(r.nodes.n_plan.model, undefined, 'the run model rides at spawn, as without a fill');
  assert.deepEqual(r.fillNotes.filled, []);
  assert.equal(r.fillNotes.kept.run.length, agents(r).length);
});

test('a fill that needs the sign-in while signed out falls through with one note; a filled model never enters signInBlocked', async () => {
  writeUser({ modelRoles: { claude: { deep: { model: GW }, everyday: { model: 'claude-haiku-4-5' } } } });
  const r = await resolve('wf_shape', { ...fill('lean'), claudeAuth: auth('signed-out') });
  assert.equal(r.nodes.n_plan.model, GW, 'falls to the next layer: the role');
  assert.deepEqual(r.fillNotes.filled, []);
  assert.equal((r.factoryNotes || []).filter((n) => n.setting === 'care').length, 4, 'one note per node, one line per setting');
  assert.ok(!(r.signInBlocked || []).some((b) => b.source === 'care'));
});

test('a node the fill wins raises no factory note, signed out', async () => {
  writeUser({ modelRoles: { claude: { everyday: { model: GW } } } });
  const plain = await resolve('wf_shape', { claudeAuth: auth('signed-out') });
  assert.ok((plain.factoryNotes || []).some((n) => n.nodeId === 'n_roles' && !n.role), 'without the fill the factory default is dropped with a note');
  const r = await resolve('wf_shape', { ...fill('lean'), claudeAuth: auth('signed-out') });
  assert.equal(r.nodes.n_roles.model, GW);
  assert.ok(!(r.factoryNotes || []).some((n) => n.nodeId === 'n_roles' && !n.role));
  assert.ok(r.fillNotes.filled.includes('n_roles'));
});

test('a pinned pair and an Auto resolve (ignoreProjectOverrides) are never filled', async () => {
  writeUser({ modelRoles: { claude: ROLES } });
  const r = await resolve('wf_shape', { ...fill('lean'), agentPair: { model: 'claude-opus-5-5', effort: 'high' } });
  for (const nc of agents(r)) assert.equal(nc.model, 'claude-opus-5-5');
  assert.deepEqual(r.fillNotes.filled, []);
  const auto = await resolve('wf_shape', { ...fill('lean'), ignoreProjectOverrides: true });
  assert.deepEqual(auto.fillNotes.filled, []);
});

test('a hand-built non-Shaper workflow uses roleFill with no engine change', async () => {
  writeUser({ modelRoles: { claude: ROLES } });
  const { id } = await writeGraphWorkflow({
    name: 'Care probe', domain: 'coding',
    nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
      { id: 'n_impl', kind: 'agent', key: 'implementer', x: 600, y: 0, config: {} },
      { id: 'n_end', kind: 'end', x: 900, y: 0, config: {} }],
    wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
      { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
      { id: 'w3', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_end', port: 'result' } }],
  });
  const r = await resolve(id, { roleFill: { source: 'budget', roles: { deep: 'everyday' } } });
  assert.equal(r.nodes.n_plan.model, EVERYDAY);
  assert.deepEqual(r.fillNotes, { source: 'budget', filled: ['n_plan'], kept: { run: [], project: [], slot: [] } });
});

test('without roleFill (or with an invalid one) the output deep-equals today\'s', async () => {
  writeUser({ modelRoles: { claude: ROLES } });
  const dir = gitDir('care-none');
  const today = await resolve('wf_shape', {}, dir);
  assert.equal('fillNotes' in today, false);
  for (const bad of [null, 'lean', { source: '', roles: {} }, { source: 'care', roles: { deep: 'strong' } }, { source: 'care' }]) {
    const r = await resolve('wf_shape', { roleFill: bad }, dir);
    assert.deepEqual(Object.keys(r).sort(), Object.keys(today).sort(), JSON.stringify(bad));
    assert.deepEqual(r.nodes, today.nodes);
  }
});

test('every built-in Shaper workflow declares no session groups (a fill never re-runs the session gate)', async () => {
  const ids = [...new Set([...RESERVED_WORKFLOW_IDS, ...SHAPE_REQ_WORKFLOW_IDS, ...SHAPE_SLICE_REQ_WORKFLOW_IDS])].filter((id) => id.startsWith('wf_shape'));
  assert.ok(ids.length >= 6, ids.join());
  for (const id of ids) {
    const r = await resolve(id);
    assert.deepEqual(resolveSessions(r.template, r.ports, { loops: r.loops }), [], id);
    assert.ok(await readWorkflow(id), id);
  }
});

test('C1 flag off: the resolved slice-run graphs keep dev\'s node keys and gate wires (no Prototype node, w9 at 3, Clarify in place)', async () => {
  const prevFlags = process.env.WORCA_FLAGS;
  delete process.env.WORCA_FLAGS;
  try {
    const dir = gitDir('care-proto-off');
    const end = (x) => x?.node ?? x;
    const gates = (r) => r.template.wires.filter((w) => w.config?.maxCycles != null).map((w) => [w.id, end(w.from), end(w.to), w.config.maxCycles]);
    const slice = await resolve('wf_shape_slice_req', {}, dir);
    assert.deepEqual(slice.template.nodes.map((n) => n.id), ['n_task', 'n_clarify', 'n_plan', 'n_refine', 'n_impl', 'n_review', 'n_end', 'n_roles']);
    assert.deepEqual(gates(slice), [['w5', 'n_refine', 'n_roles', 2], ['w9', 'n_review', 'n_impl', 3]]);
    const ux = await resolve('wf_shape_ux_slice_req', {}, dir);
    assert.deepEqual(ux.template.nodes.map((n) => n.id), ['n_task', 'n_clarify', 'n_plan', 'n_refine', 'n_impl', 'n_review', 'n_check', 'n_webui', 'n_end', 'n_or', 'n_roles']);
    assert.deepEqual(gates(ux), [['w5', 'n_refine', 'n_roles', 2], ['w9', 'n_review', 'n_or', 3], ['w14', 'n_webui', 'n_or', 3]]);
  } finally {
    if (prevFlags === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prevFlags;
  }
});
