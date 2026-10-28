// test/ask-proposal-presets.test.mjs — propose_run with presetId (#712 slice 3, D9–D12): the card carries the preset's
// picks, fields the model passes win, a Permissive preset is refused as is, and list_presets shows the scope's presets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProposalValidator } from '../src/core/ask/proposal.mjs';
import { presetProposalInput, PRESET_PROPOSAL_ERRORS } from '../src/core/ask/proposal-preset.mjs';

const PK = 'demo-00000001';
const WF = { id: 'wf_review', name: 'Review only', version: 2, nodes: [
  { id: 'n_task', kind: 'task', config: {} }, { id: 'n_plan', kind: 'agent', key: 'planner', config: {} },
  { id: 'n_end', kind: 'end', config: {} }], wires: [] };
const OTHER = { id: 'wf_other', name: 'Other', version: 2, nodes: [{ id: 'n_impl', kind: 'agent', key: 'implementer', config: {} }], wires: [] };
const MODELS = [{ id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'], engine: 'claude', harnesses: ['claude'] }];
const FAKE_DEPS = {
  listProjects: async () => [{ key: PK, name: 'Demo', path: '/p/demo', exists: true }],
  readWorkspace: async (id) => (id === 'wks-team-0000abcd'
    ? { id, name: 'Team', description: '', projectPaths: ['/p/a'], projectKeys: ['a-00000001'], exists: [true] } : null),
  assertRunnableWorkflow: async (id) => {
    if (id === WF.id) return WF;
    if (id === OTHER.id) return OTHER;
    throw Object.assign(new Error(`unknown workflowId "${id}"`), { code: 'NOT_FOUND' });
  },
  readWorkflow: async (id) => (id === WF.id ? WF : id === OTHER.id ? OTHER : null),
  readGuardrailSet: async (id) => (['permissive', 'normal', 'secure'].includes(id) ? { id } : null),
  isGitRepo: () => true,
  pathExists: () => true,
  listModels: async () => MODELS,
  resolveEngine: () => 'claude',
  claudeAuth: async () => 'signed-in',
  routed: () => false,
  policyFields: () => ({}),
  costOf: () => null,
};

const QUICK = { id: 'rp_aaaaaaaaaaaa', name: 'Quick fix', scope: { kind: 'project', ref: PK },
  setup: { workflowId: 'wf_review', guardrailsId: 'normal', engine: 'claude', nightMode: true, humanInLoop: false,
    overlay: { nodes: { n_plan: { model: 'claude-haiku-4-5', effort: 'medium', fanOut: false } }, wires: { w_review: { maxCycles: 2 } } } } };
const OPEN = { id: 'rp_bbbbbbbbbbbb', name: 'Wide open', scope: { kind: 'global', ref: null }, setup: { workflowId: 'wf_review' } };
const PRESETS = { [QUICK.id]: QUICK, [OPEN.id]: OPEN };
const make = (extra = {}) => createProposalValidator({ ...FAKE_DEPS,
  readPreset: async (id, { owner }) => (owner === 'eve' ? null : PRESETS[id] || null), ...extra }).validateProposal;

test('propose_run with presetId returns the preset\'s picks on the card', async () => {
  const r = await make()({ presetId: QUICK.id, brief: 'fix the login bug', projectKey: PK }, { owner: null });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.card.workflowId, 'wf_review');
  assert.equal(r.card.guardrailsId, 'normal');
  assert.equal(r.card.engine, 'claude');
  assert.equal(r.card.nodes.n_plan.model, 'claude-haiku-4-5');
  assert.equal(r.card.nodes.n_plan.effort, 'medium');
  assert.deepEqual(r.card.preset, { id: QUICK.id, name: 'Quick fix', workflowId: 'wf_review',
    setup: { nightMode: true, humanInLoop: false, overlay: QUICK.setup.overlay } });
});

test('a Permissive preset is refused as is; naming stricter guardrails makes it a card', async () => {
  const v = make();
  const r = await v({ presetId: OPEN.id, brief: 'x', projectKey: PK }, { owner: null });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, [PRESET_PROPOSAL_ERRORS.permissive('Wide open')]);
  const explicit = await v({ presetId: OPEN.id, brief: 'x', projectKey: PK, guardrailsId: 'permissive' }, { owner: null });
  assert.equal(explicit.ok, false, 'naming permissive is still the existing refusal');
  const ok = await v({ presetId: OPEN.id, brief: 'x', projectKey: PK, guardrailsId: 'normal' }, { owner: null });
  assert.equal(ok.ok, true);
  assert.equal(ok.card.guardrailsId, 'normal');
});

test('fields the model passes win; another workflow drops the preset\'s agent picks', async () => {
  const r = await make()({ presetId: QUICK.id, brief: 'x', projectKey: PK, workflowId: 'wf_other' }, { owner: null });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.card.workflowId, 'wf_other');
  assert.equal(r.card.nodes, undefined);
  assert.equal(r.card.preset.setup.overlay, undefined);
});

test('unknown, another person\'s, pinned elsewhere, broken, and no preset reader', async () => {
  const v = make();
  assert.match((await v({ presetId: 'rp_cccccccccccc', brief: 'x', projectKey: PK }, { owner: null })).errors[0], /preset rp_cccccccccccc not found — list_presets shows the ids/);
  assert.match((await v({ presetId: QUICK.id, brief: 'x', projectKey: PK }, { owner: 'eve' })).errors[0], /not found/);
  const pinned = await v({ presetId: QUICK.id, brief: 'x', workspaceId: 'ws_1' }, { owner: null });
  assert.match(pinned.errors[0], /Preset "Quick fix" is pinned to project demo-00000001/);
  const gone = { ...QUICK, setup: { ...QUICK.setup, guardrailsId: 'gr_gone' } };
  const broken = await make({ readPreset: async () => gone })({ presetId: QUICK.id, brief: 'x', projectKey: PK }, { owner: null });
  assert.equal(broken.ok, false);
  assert.match(broken.errors.join('; '), /gr_gone/);
  const off = await make({ readPreset: null })({ presetId: QUICK.id, brief: 'x', projectKey: PK }, { owner: null });
  assert.deepEqual(off.errors, [PRESET_PROPOSAL_ERRORS.off]);
});

test('presetProposalInput fills the target from a pinned preset when the call names none', () => {
  const { input, errors } = presetProposalInput(QUICK, { brief: 'x' });
  assert.deepEqual(errors, []);
  assert.equal(input.projectKey, PK);
});

test('list_presets: the viewer\'s presets for the pinned scope, plus any-project ones', async () => {
  const { createAskTools } = await import('../src/core/ask/tools.mjs');
  const { ASK_LIMITS } = await import('../src/core/ask/limits.mjs');
  // createAskTools reads deps.limits while building its tool list, so `limits` is required.
  const TOOL_DEPS = { limits: ASK_LIMITS, redact: (s) => s };
  const t = createAskTools({ ...TOOL_DEPS, pinnedScope: () => ({ projectKey: PK }),
    listPresets: () => [QUICK, OPEN, { id: 'rp_dddddddddddd', name: 'Elsewhere', scope: { kind: 'project', ref: 'other-1' }, setup: {} }] });
  assert.ok(t.list().some((d) => d.name === 'list_presets'), 'listed when the dep is there');
  const out = await t.call('list_presets', {});
  assert.deepEqual(out.presets.map((p) => p.name), ['Quick fix', 'Wide open']);
  assert.deepEqual(Object.keys(out.presets[0]).sort(), ['engine', 'guardrailsId', 'id', 'name', 'scope', 'workflowId']);
  assert.equal(out.presets[0].engine, 'claude');
  assert.equal(out.presets[1].engine, null, 'a preset naming no engine runs on the default engine, shown as null');
  assert.equal(out.presets[1].guardrailsId, 'permissive', 'a preset naming none is shown as what it runs');
  const without = createAskTools(TOOL_DEPS);
  assert.equal(without.list().some((d) => d.name === 'list_presets'), false, 'not listed without the dep');
  assert.deepEqual(await without.call('list_presets', {}), { presets: [] });
});
