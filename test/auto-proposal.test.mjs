import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleShape } from '../src/shared/graph/assemble.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { isomorphic } from '../src/shared/graph/isomorphic.mjs';
import { remapTunables, buildProposal, sanitizeProposalAnswer, mintAutoWorkflowId } from '../src/core/auto/proposal.mjs';

const REG = loadAgentRegistry(undefined, { userAgentsDir: null, includePlugins: false });
const MODELS = [{ id: 'claude-opus-5', label: 'Opus 5', efforts: ['medium', 'high', 'max'] }, { id: 'claude-sonnet-5', label: 'Sonnet 5', efforts: ['medium', 'high'] }, { id: 'claude-hidden-9', label: 'Hidden', efforts: ['medium'], hidden: true }];
const S = (agent, extra = {}) => ({ agent, ...extra });
const seed = (id) => SEED_TEMPLATES.find((t) => t.id === id);

function proposalFor({ match = null } = {}) {
  const shape = { name: 'Quick and careful', reasoning: 'small task', taskKind: 'prompt', size: 'medium', signals: ['web UI', '9 agent cards read'], stages: [S('planner', { model: 'claude-opus-5', effort: 'high' }), S('implementer', { fanOut: true }), S('reviewer')] };
  const built = assembleShape(shape, { registry: REG });
  let template = built.template;
  let tunables = built.tunables;
  if (match) { tunables = remapTunables(tunables, isomorphic(template, match)); template = match; }
  return buildProposal({ round: 2, shape: built.shape, template, match: match ? { id: match.id, name: match.name } : null, tunables, registry: REG, models: MODELS, warnings: [{ code: 'X', message: 'a warning' }], costUsd: 0.03, fingerprint: 'top-level: src/', ignoredProjectOverrides: !!match });
}

test('remapTunables follows the node map', () => {
  assert.deepEqual(remapTunables({ n_planner: { model: 'm' }, n_x: { effort: 'high' } }, new Map([['n_planner', 'n_plan']])), { n_plan: { model: 'm' } });
});

test('buildProposal: a new workflow — manifest under wf_auto, dispatch order, nodes with editability flags, visible models, cost, fingerprint', () => {
  const p = proposalFor();
  assert.equal(p.round, 2);
  assert.equal(p.name, 'Quick and careful');
  assert.equal(p.reasoning, 'small task');
  assert.equal(p.taskKind, 'prompt'); assert.equal(p.size, 'medium'); assert.deepEqual(p.signals, ['web UI', '9 agent cards read']);
  assert.deepEqual(p.warnings, ['a warning']);
  assert.equal(p.match, null);
  assert.equal(p.costUsd, 0.03);
  assert.equal(p.fingerprint, 'top-level: src/');
  assert.equal(p.ignoredProjectOverrides, false);
  assert.equal(p.manifest.version, 2);
  assert.deepEqual(p.manifest.template, { id: 'wf_auto', name: 'Quick and careful' });
  assert.equal(p.manifest.graph.nodes.length, 5);
  assert.deepEqual(p.order, ['n_planner', 'n_implementer', 'n_reviewer'], 'the dispatch order from the manifest steps');
  const plan = p.manifest.graph.nodes.find((n) => n.id === 'n_planner');
  assert.equal(plan.model, 'claude-opus-5', 'the manifest carries the picks');
  assert.equal(plan.effort, 'high');
  assert.deepEqual(Object.keys(p.nodes).sort(), ['n_implementer', 'n_planner', 'n_reviewer']);
  assert.deepEqual(p.nodes.n_planner, { key: 'planner', label: 'Plan', model: 'claude-opus-5', effort: 'high', fanOut: true, askQuestions: false, asksQuestions: true, questionsLocked: false, canFanOut: true });
  assert.equal(p.nodes.n_implementer.fanOut, true);
  assert.equal(p.nodes.n_reviewer.model, '');
  assert.deepEqual(p.models, MODELS.filter((m) => !m.hidden).map((m) => ({ id: m.id, label: m.label, efforts: m.efforts })), 'hidden catalog entries are not offered');
});

test('buildProposal: a matched workflow — the candidate ids and its own id ride the manifest; order follows the row', () => {
  const p = proposalFor({ match: seed('wf_quick-fix') });
  assert.deepEqual(p.match, { id: 'wf_quick-fix', name: 'Quick Fix' });
  assert.deepEqual(p.manifest.template, { id: 'wf_quick-fix', name: 'Quick and careful' });
  assert.equal(p.manifest.graph.nodes.find((n) => n.id === 'n_plan').model, 'claude-opus-5', 'tunables were remapped onto the row ids');
  assert.deepEqual(Object.keys(p.nodes).sort(), ['n_impl', 'n_plan', 'n_review']);
  assert.deepEqual(p.order, ['n_plan', 'n_impl', 'n_review']);
  assert.equal(p.ignoredProjectOverrides, true);
});

test('sanitizeProposalAnswer keeps only legal edits', () => {
  const p = proposalFor();
  const ctx = { proposal: p, models: MODELS, registry: REG };
  assert.deepEqual(sanitizeProposalAnswer({ decision: 'cancel', junk: 1 }, ctx), { decision: 'cancel' });
  assert.deepEqual(sanitizeProposalAnswer({ decision: 'revise', text: '  drop the reviewer ' }, ctx), { decision: 'revise', text: 'drop the reviewer' });
  assert.equal(sanitizeProposalAnswer({ decision: 'revise', text: '   ' }, ctx), null);
  assert.equal(sanitizeProposalAnswer({ decision: 'maybe' }, ctx), null);
  assert.equal(sanitizeProposalAnswer(null, ctx), null);
  const acc = sanitizeProposalAnswer({
    decision: 'accept', name: '  Renamed \x1b[31m  twice ',
    nodes: {
      n_planner: { model: 'CLAUDE-SONNET-5', effort: 'high', fanOut: false, askQuestions: true },
      n_reviewer: { model: 'gpt-9', effort: 'max', askQuestions: true },
      n_implementer: { model: '', effort: 'max' },
      n_ghost: { model: 'claude-opus-5' },
    },
  }, ctx);
  assert.equal(acc.decision, 'accept');
  assert.equal(acc.name, 'Renamed twice', 'the name is cleaned like every model/user text');
  assert.deepEqual(acc.nodes, {
    n_planner: { model: 'claude-sonnet-5', effort: 'high', fanOut: false, askQuestions: true },
    n_reviewer: { askQuestions: true },        // unknown model + its effort dropped; askQuestions allowed (reviewer asks, not locked)
    n_implementer: { model: '', effort: '' },  // '' clears the model AND the effort (a row's authored effort must not survive alone)
  });
  assert.equal(sanitizeProposalAnswer({ decision: 'accept' }, ctx).name, 'Quick and careful');
  assert.deepEqual(sanitizeProposalAnswer({ decision: 'accept', nodes: { n_planner: { model: 'claude-hidden-9', effort: 'medium' } } }, ctx).nodes,
    { n_planner: { model: 'claude-hidden-9', effort: 'medium' } }, 'a hidden catalog id still resolves (pickers skip it, validators accept it)');
});

test('askQuestions on a questionsLocked agent and fanOut on an agent that cannot fan out are dropped', () => {
  const built = assembleShape({ stages: [S('clarify'), S('planner'), S('manualTestsChecklist')] }, { registry: REG });
  const p = buildProposal({ round: 1, shape: built.shape, template: built.template, match: null, tunables: built.tunables, registry: REG, models: MODELS });
  assert.equal(p.nodes.n_clarify.questionsLocked, true);
  assert.equal(p.nodes.n_clarify.askQuestions, true);
  assert.equal(p.nodes.n_manualtestschecklist.canFanOut, false);
  const acc = sanitizeProposalAnswer({ decision: 'accept', nodes: { n_clarify: { askQuestions: false }, n_manualtestschecklist: { fanOut: true } } }, { proposal: p, models: MODELS, registry: REG });
  assert.deepEqual(acc.nodes, {});
});

test('a non-finite cost is normalised to 0', () => {
  const built = assembleShape({ stages: [S('implementer')] }, { registry: REG });
  const p = buildProposal({ round: 1, shape: built.shape, template: built.template, tunables: {}, registry: REG, models: MODELS, costUsd: NaN });
  assert.equal(p.costUsd, 0);
  assert.equal(buildProposal({ round: 1, shape: built.shape, template: built.template, tunables: {}, registry: REG, models: MODELS }).costUsd, 0);
});

test('B1: a tunable model WITHOUT an effort paints effort "" (what resolveGraph runs) in the table AND the manifest, never the row\'s authored effort', () => {
  const built = assembleShape({ name: 'Twin', taskKind: 'prompt', stages: [S('planner'), S('implementer'), S('reviewer')] }, { registry: REG });
  // a composer-authored twin: the planner node carries model + effort in its config
  const twin = { ...built.template, id: 'wf_twin', name: 'Twin', nodes: built.template.nodes.map((n) => (n.id === 'n_planner' ? { ...n, config: { model: 'claude-opus-5', effort: 'high' } } : n)) };
  const p = (tunables) => {
    const b = buildProposal({ round: 1, shape: built.shape, template: twin, match: { id: 'wf_twin', name: 'Twin' }, tunables, registry: REG, models: MODELS });
    const cell = b.manifest.graph.nodes.find((n) => n.id === 'n_planner');
    return [b.nodes.n_planner.model, b.nodes.n_planner.effort, cell.model, cell.effort];
  };
  assert.deepEqual(p({}), ['claude-opus-5', 'high', 'claude-opus-5', 'high'], 'no overlay: the row\'s own model + effort run');
  assert.deepEqual(p({ n_planner: { model: 'claude-sonnet-5' } }), ['claude-sonnet-5', '', 'claude-sonnet-5', ''], 'a model without an effort: the resolver drops the row\'s effort, so neither the table nor the graph chips may show it');
  assert.deepEqual(p({ n_planner: { model: 'claude-sonnet-5', effort: 'medium' } }), ['claude-sonnet-5', 'medium', 'claude-sonnet-5', 'medium']);
  assert.deepEqual(p({ n_planner: { effort: 'medium' } }), ['claude-opus-5', 'medium', 'claude-opus-5', 'medium'], 'an effort alone overrides the row\'s effort');
});

test('mintAutoWorkflowId slugs the name, avoids reserved ids and bumps on collision', async () => {
  const taken = new Set(['wf_plan-and-build', 'wf_plan-and-build-2']);
  const exists = async (id) => taken.has(id);
  assert.equal(await mintAutoWorkflowId('Plan and build', exists), 'wf_plan-and-build-3');
  assert.equal(await mintAutoWorkflowId('Something else', exists), 'wf_something-else');
  assert.equal(await mintAutoWorkflowId('Default', exists), 'wf_auto-workflow');
  assert.equal(await mintAutoWorkflowId('auto', exists), 'wf_auto-workflow');
  assert.equal(await mintAutoWorkflowId('', exists), 'wf_auto-workflow');
});
