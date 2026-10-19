// test/ask-proposal-nodes.test.mjs — propose_run `nodes` (docs/models.md "Per-agent models for one run"): per-agent
// picks for ONE run, checked like the run API (run-overlay.mjs) plus Ask's own rules (signed-out installs, the team
// policy's allowed models as a warning), carried on the card as `nodes` / `warnings` only when present.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import { createProposalValidator, PROPOSAL_ERRORS, proposalClaudeAuth } from '../src/core/ask/proposal.mjs';
import { buildMcpConfig } from '../src/core/ask/spawn.mjs';

const WF = { id: 'wf_review', name: 'Review only', version: 2, nodes: [
  { id: 'n_task', kind: 'task', config: {} }, { id: 'n_plan', kind: 'agent', key: 'planner', config: {} },
  { id: 'n_impl', kind: 'agent', key: 'implementer', config: {} }, { id: 'n_end', kind: 'end', config: {} }], wires: [] };
const MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'], engine: 'claude', harnesses: ['claude'] },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'], engine: 'claude', harnesses: ['claude'] },
  { id: 'gpt-5.5', label: 'GPT-5.5', efforts: ['minimal', 'low', 'medium', 'high'], engine: 'codex', harnesses: ['codex'] },
  { id: 'gw-coder', label: 'Gateway coder', efforts: ['medium', 'high'], engine: 'claude', harnesses: ['claude'], routed: true, connection: { kind: 'env' } },
];
function validator(over = {}) {
  const calls = { auth: 0, models: [], engines: [], policy: [] };
  const deps = {
    listProjects: async () => [{ key: 'demo-00000001', name: 'Demo', path: '/p/demo', exists: true }],
    readWorkspace: async (id) => (id === 'wks-team-0000abcd'
      ? { id, name: 'Team', description: '', projectPaths: ['/p/a', '/p/b'], projectKeys: ['a-00000001', 'b-00000002'], policyProject: '/p/b' } : null),
    assertRunnableWorkflow: async (id) => {
      if (id === 'wf_review') return WF;
      if (id === 'wf_auto') return { id: 'wf_auto', name: 'Auto', version: 2, domain: 'coding', auto: true };
      if (id === 'wf_memory_defrag') return { id: 'wf_memory_defrag', name: 'Memory defragment', version: 2, domain: 'shared', nodes: [{ id: 'n_defrag', kind: 'agent', key: 'memoryDefragmenter' }], wires: [] };
      throw Object.assign(new Error(`unknown workflowId "${id}"`), { code: 'NOT_FOUND' });
    },
    readGuardrailSet: async (id) => ({ id }),
    isGitRepo: () => true,
    pathExists: () => true,
    listModels: async (dir) => { calls.models.push(dir); return MODELS; },
    resolveEngine: (scope) => { calls.engines.push(scope); return 'claude'; },
    claudeAuth: async () => { calls.auth += 1; return 'signed-in'; },
    routed: (id) => id === 'gw-coder',
    policyFields: (q) => { calls.policy.push(q); return {}; },
    costOf: () => null,
    ...over,
  };
  return { validateProposal: createProposalValidator(deps).validateProposal, calls };
}
const base = { projectKey: 'demo-00000001', workflowId: 'wf_review', brief: 'Fix the login bug' };
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.card; };
const errs = (r) => { assert.equal(r.ok, false, JSON.stringify(r)); return r.errors; };

test('no nodes: the card keeps its pinned shape and nothing is read (no catalog, no sign-in probe)', async () => {
  const { validateProposal, calls } = validator();
  const card = ok(await validateProposal(base));
  assert.equal('nodes' in card, false);
  assert.equal('warnings' in card, false);
  assert.deepEqual([calls.models.length, calls.auth, calls.engines.length], [0, 0, 0]);
});

test('valid picks: catalog casing, every model names its effort, reasons cleaned and capped, facts from model-tiers', async () => {
  const { validateProposal, calls } = validator();
  const long = `Plans the auth${String.fromCharCode(0x2028)}change ${'x'.repeat(400)}`;
  const card = ok(await validateProposal({ ...base, nodes: { n_plan: { model: 'CLAUDE-OPUS-5-5', effort: 'high', reason: long }, n_impl: { model: 'claude-haiku-4-5', subagentModel: 'sonnet' } } }));
  assert.deepEqual(Object.keys(card.nodes), ['n_plan', 'n_impl']);
  assert.deepEqual([card.nodes.n_plan.model, card.nodes.n_plan.effort], ['claude-opus-5-5', 'high']);
  assert.equal(card.nodes.n_plan.reason.length, ASK_LIMITS.proposalReasonMaxChars);
  assert.ok(card.nodes.n_plan.reason.startsWith('Plans the auth change '), 'a line separator becomes a space');
  assert.equal(card.nodes.n_plan.facts, 'anthropic · top tier · $4/$20 per Mtok · 1M context · runs on claude · efforts medium/high/xhigh/max');
  const { facts, ...impl } = card.nodes.n_impl;
  assert.deepEqual(impl, { model: 'claude-haiku-4-5', effort: '', subagentModel: 'sonnet' });
  assert.match(facts, /^anthropic · mid tier · \$1\/\$5 per Mtok/);
  assert.equal('warnings' in card, false);
  assert.deepEqual(calls.models, ['/p/demo'], 'the project\'s own catalog');
  assert.deepEqual(calls.engines, [{ projectDir: '/p/demo' }], 'the run engine of THIS project when the proposal names none');
});

test('errors: not an agent node, unknown model, an effort the model lacks, an effort or a pick without a model, another engine\'s model, junk', async () => {
  const { validateProposal } = validator();
  assert.deepEqual(errs(await validateProposal({ ...base, nodes: { n_ghost: { model: 'claude-opus-5-5' }, n_task: { model: 'claude-opus-5-5' }, n_plan: { model: 'gone' }, n_impl: { model: 'claude-haiku-4-5', effort: 'max' } } })), [
    'node "n_ghost" is not an agent node of workflow wf_review', 'node "n_task" is not an agent node of workflow wf_review',
    'node "n_plan": unknown model "gone"', 'node "n_impl": model claude-haiku-4-5 has no effort "max"']);
  assert.deepEqual(errs(await validateProposal({ ...base, nodes: { n_plan: { effort: 'high' } } })), ['node "n_plan": an effort needs a model']);
  assert.deepEqual(errs(await validateProposal({ ...base, nodes: { n_plan: { reason: 'x' } } })), [PROPOSAL_ERRORS.nodeNoModel('n_plan')]);
  assert.deepEqual(errs(await validateProposal({ ...base, nodes: { n_plan: { model: 'gpt-5.5' } } })), ['node "n_plan": gpt-5.5 runs on Codex, not on Claude — pick a model this run\'s engine runs']);
  assert.deepEqual(errs(await validateProposal({ ...base, nodes: { n_plan: { model: 'claude-opus-5-5', fanOut: true } } })), ['nodes.n_plan: unknown key "fanOut"']);
  assert.deepEqual(errs(await validateProposal({ ...base, nodes: ['n_plan'] })), ['nodes must be an object keyed by node id']);
  assert.deepEqual(errs(await validateProposal({ ...base, nodes: { n_plan: { model: 'claude-opus-5-5', subagentModel: 'gpt' } } })), ['node "n_plan": unknown sub-agent model "gpt"']);
});

test('the engine: a named engine decides; without one the run\'s default engine does; Codex never probes Claude\'s sign-in', async () => {
  const a = validator();
  ok(await a.validateProposal({ ...base, engine: 'codex', nodes: { n_plan: { model: 'gpt-5.5', effort: 'low' } } }));
  assert.equal(a.calls.auth, 0);
  const b = validator({ resolveEngine: () => 'codex' });
  assert.deepEqual(errs(await b.validateProposal({ ...base, nodes: { n_plan: { model: 'claude-opus-5-5' } } })), ['node "n_plan": claude-opus-5-5 runs on Claude, not on Codex — pick a model this run\'s engine runs']);
});

test('nodes are refused with Auto (it picks at start) and the Memory defragment workflow (Settings › Memory owns its model)', async () => {
  const { validateProposal } = validator();
  assert.deepEqual(errs(await validateProposal({ ...base, workflowId: 'wf_auto', nodes: { n_plan: { model: 'claude-opus-5-5' } } })), [PROPOSAL_ERRORS.nodesAuto]);
  assert.deepEqual(errs(await validateProposal({ ...base, workflowId: 'wf_memory_defrag', memoryScope: 'project', nodes: { n_defrag: { model: 'claude-opus-5-5' } } })), [PROPOSAL_ERRORS.nodesDefrag]);
});

test('signed out: every agent node needs a model the install can run (routed through an endpoint or provider)', async () => {
  let probes = 0;
  const { validateProposal } = validator({ claudeAuth: async () => { probes += 1; return 'signed-out'; } });
  assert.deepEqual(errs(await validateProposal({ ...base, nodes: { n_plan: { model: 'claude-opus-5-5' } } })), [
    'node "n_impl": needs a model — this install has no default model (Claude Code is not signed in)',
    PROPOSAL_ERRORS.signedOutPick('n_plan', 'claude-opus-5-5')]);
  ok(await validateProposal({ ...base, nodes: { n_plan: { model: 'gw-coder' }, n_impl: { model: 'GW-CODER', effort: 'high' } } }));
  assert.equal(probes, 2, 'probed once per proposal with nodes');
  // Readiness is no part of the rule: the MCP child cannot read a `${VAR}` provider key, so a routed model whose
  // provider reads "not ready" there must count in both processes alike (the run fails fast if it really is not).
  const unready = validator({ claudeAuth: async () => 'signed-out', listModels: async () => MODELS.map((m) => (m.id === 'gw-coder' ? { ...m, needsSignIn: true } : m)) });
  assert.deepEqual(errs(await unready.validateProposal({ ...base, nodes: { n_plan: { model: 'gw-coder' } } })),
    ['node "n_impl": needs a model — this install has no default model (Claude Code is not signed in)'], 'the routed model still counts');
});

test('team policy: a model outside the allowed list is a WARNING on the card, never a refusal; a workspace asks its policy home', async () => {
  const allowed = { 'models.allowed': { value: ['claude-opus-5-5'], kind: 'soft' } };
  const { validateProposal } = validator({ policyFields: () => allowed });
  const card = ok(await validateProposal({ ...base, nodes: { n_plan: { model: 'claude-opus-5-5' }, n_impl: { model: 'claude-haiku-4-5' } } }));
  assert.deepEqual(card.warnings, ["The implementer's model claude-haiku-4-5 is not in the allowed list (claude-opus-5-5). The run proceeds and is recorded as off-policy."],
    'the run records a per-run pick as off-policy (run-harness _resolvePolicy reads manifest.runOverlay)');
  const ws = validator();
  ok(await ws.validateProposal({ workspaceId: 'wks-team-0000abcd', workflowId: 'wf_review', brief: 'x', nodes: { n_plan: { model: 'claude-opus-5-5' } } }));
  assert.deepEqual(ws.calls.models, [''], 'a workspace reads the project-less catalog');
  assert.deepEqual(ws.calls.engines, [{ workspace: true }]);
  assert.deepEqual(ws.calls.policy, [{ projectDir: null, policyProject: '/p/b' }]);
});

test('a premium-tier pick (Fable 5.1) is a WARNING on the card naming its model id; a policy read error never drops it', async () => {
  const FABLE = { id: 'claude-fable-5-1', label: 'Fable 5.1', efforts: ['medium', 'high', 'xhigh', 'max'], engine: 'claude', harnesses: ['claude'] };
  const PRICEY = { id: 'gw-pricey', label: 'gw-pricey', efforts: ['high'], engine: 'claude', harnesses: ['claude'], connection: { kind: 'env' } };
  const listModels = async () => [...MODELS, FABLE, PRICEY];
  const premium = "The planner's model claude-fable-5-1 (Fable 5.1) is a premium model (~2.5× Opus 5.5 list price): keep it only if the user asked for it.";
  const one = validator({ listModels });
  const card = ok(await one.validateProposal({ ...base, nodes: { n_plan: { model: 'claude-fable-5-1', effort: 'high' }, n_impl: { model: 'claude-opus-5-5' } } }));
  assert.deepEqual(card.warnings, [premium], 'Opus 5.5 is top tier: no word on it');
  assert.match(card.nodes.n_plan.facts, /^anthropic · premium tier · \$10\/\$50 per Mtok/);
  // The team policy's word comes first; a policy read that throws drops only its own.
  const allowed = { 'models.allowed': { value: ['claude-opus-5-5'], kind: 'soft' } };
  const both = ok(await validator({ listModels, policyFields: () => allowed }).validateProposal({ ...base, nodes: { n_plan: { model: 'claude-fable-5-1' } } }));
  assert.deepEqual(both.warnings, ["The planner's model claude-fable-5-1 is not in the allowed list (claude-opus-5-5). The run proceeds and is recorded as off-policy.", premium]);
  const broken = validator({ listModels, policyFields: () => { throw new Error('policy cache unreadable'); } });
  assert.deepEqual(ok(await broken.validateProposal({ ...base, nodes: { n_plan: { model: 'claude-fable-5-1' } } })).warnings, [premium]);
  const twin = validator({ listModels, assertRunnableWorkflow: async () => ({ ...WF, nodes: [...WF.nodes, { id: 'n_plan2', kind: 'agent', key: 'planner', config: {} }] }) });
  assert.deepEqual(ok(await twin.validateProposal({ ...base, nodes: { n_plan: { model: 'claude-fable-5-1' }, n_plan2: { model: 'CLAUDE-FABLE-5-1' } } })).warnings, [premium],
    'two nodes of one agent on the same model: said once');
  // The facts' tier decides: the entry's own cost moves a model into or out of premium; a label equal to the id is said once.
  const costs = { 'gw-pricey': { perMtok: { input: 9, output: 45 } }, 'claude-fable-5-1': { perMtok: { input: 4, output: 20 } } };
  const priced = validator({ listModels, costOf: (id) => costs[id] || null });
  assert.deepEqual(ok(await priced.validateProposal({ ...base, nodes: { n_plan: { model: 'claude-fable-5-1' }, n_impl: { model: 'gw-pricey', effort: 'high' } } })).warnings,
    ["The implementer's model gw-pricey is a premium model (~2.3× Opus 5.5 list price): keep it only if the user asked for it."]);
});

test('the sign-in answer is the parent turn\'s: the MCP child reads WORCA_ASK_CLAUDE_AUTH, never its own probe', async () => {
  const prev = process.env.WORCA_ASK_CLAUDE_AUTH;
  process.env.WORCA_ASK_CLAUDE_AUTH = 'signed-out';
  try {
    const { validateProposal } = validator({ claudeAuth: undefined });   // the default reader
    assert.deepEqual(errs(await validateProposal({ ...base, nodes: { n_plan: { model: 'gw-coder' } } })),
      ['node "n_impl": needs a model — this install has no default model (Claude Code is not signed in)']);
  } finally {
    if (prev === undefined) delete process.env.WORCA_ASK_CLAUDE_AUTH; else process.env.WORCA_ASK_CLAUDE_AUTH = prev;
  }
  const env = (o) => buildMcpConfig({ homeBase: '/b', threadId: 't', serverPath: '/s.mjs', env: {}, ...o }).mcpServers.worca.env;
  assert.equal(env({ claudeAuth: 'signed-out' }).WORCA_ASK_CLAUDE_AUTH, 'signed-out');
  assert.equal('WORCA_ASK_CLAUDE_AUTH' in env({}), false, 'no answer, no key');
  assert.equal('WORCA_ASK_CLAUDE_AUTH' in env({ claudeAuth: 'maybe' }), false, 'only the probe\'s three answers ride');
  assert.equal('WORCA_ASK_CLAUDE_AUTH' in env({ claudeAuth: 'signed-out', relay: { url: 'http://127.0.0.1:1/api/ask/relay', token: 'tok' } }), false,
    'relay mode runs the tools in the server, which probes itself');
});

test('the turn\'s own re-validation passes the answer it handed the child: validateProposal\'s claudeAuth wins over every reader', async () => {
  const { validateProposal, calls } = validator();
  assert.deepEqual(errs(await validateProposal({ ...base, nodes: { n_plan: { model: 'gw-coder' } } }, { claudeAuth: 'signed-out' })),
    ['node "n_impl": needs a model — this install has no default model (Claude Code is not signed in)']);
  ok(await validateProposal({ ...base, nodes: { n_plan: { model: 'claude-opus-5-5' } } }, { claudeAuth: 'signed-in' }));
  assert.equal(calls.auth, 0, 'no probe of its own');
});

test('proposalClaudeAuth: without a Claude-run routed model nothing is spawned — the answer could change no verdict; with one the configured binary answers', async () => {
  const bins = [];
  const probe = async ({ bin }) => { bins.push(bin); return { state: 'signed-out' }; };
  const routedGw = (id) => id === 'gw-coder';
  assert.equal(await proposalClaudeAuth({ listModels: async () => MODELS, routed: () => false, probe, env: {} }), 'unknown');
  assert.equal(await proposalClaudeAuth({ listModels: async () => MODELS.map((m) => (m.id === 'gw-coder' ? { ...m, harnesses: ['codex'] } : m)), routed: routedGw, probe, env: {} }),
    'unknown', 'routed, but the claude engine never runs it');
  assert.deepEqual(bins, [], 'nothing spawned');
  assert.equal(await proposalClaudeAuth({ listModels: async () => MODELS, routed: routedGw, probe, env: { WORCA_CLAUDE_BIN: '/opt/claude' } }), 'signed-out');
  assert.deepEqual(bins, ['/opt/claude'], 'the configured binary');
  assert.equal(await proposalClaudeAuth({ listModels: async () => MODELS, routed: routedGw, probe: async () => ({ state: 'odd' }), env: {} }), 'unknown');
  assert.equal(await proposalClaudeAuth({ listModels: async () => { throw new Error('locked'); }, probe, env: {} }), 'unknown');
});

test('the card facts read alike in the MCP child and the parent: readiness (the child cannot read ${VAR} provider keys) is never in them', async () => {
  const withReady = (needsSignIn) => validator({ listModels: async () => MODELS.map((m) => (m.id === 'gw-coder' ? { ...m, needsSignIn } : m)) });
  const pick = { ...base, nodes: { n_impl: { model: 'gw-coder', effort: 'high' } } };
  const child = ok(await withReady(true).validateProposal(pick));
  const parent = ok(await withReady(false).validateProposal(pick));
  assert.equal(child.nodes.n_impl.facts, parent.nodes.n_impl.facts, 'the model\'s result and the user\'s card show one facts line');
  assert.doesNotMatch(child.nodes.n_impl.facts, /not ready/);
});

test('signed out (the answer the turn handed down): a plain Claude proposal is told so — nothing is refused, no probe', async () => {
  const quiet = validator();
  assert.equal('notes' in (await quiet.validateProposal(base, { claudeAuth: 'signed-in' })), false);
  assert.equal('notes' in (await quiet.validateProposal(base, { claudeAuth: 'unknown' })), false);
  assert.equal('notes' in (await quiet.validateProposal(base)), false, 'no handed answer: no note, no probe');
  assert.equal('notes' in (await quiet.validateProposal({ ...base, workflowId: 'wf_auto' }, { claudeAuth: 'signed-out' })), false, 'Auto names its own models');
  assert.equal('notes' in (await quiet.validateProposal({ ...base, engine: 'codex' }, { claudeAuth: 'signed-out' })), false, 'another engine needs no Claude sign-in');
  assert.deepEqual([quiet.calls.models.length, quiet.calls.auth, quiet.calls.engines.length], [0, 0, 0], 'without a signed-out answer a plain proposal reads nothing');
  const { validateProposal, calls } = validator();
  const plain = await validateProposal(base, { claudeAuth: 'signed-out' });
  assert.equal(plain.ok, true, 'never refused: the project\'s own settings may already route every agent');
  assert.deepEqual(plain.notes, [PROPOSAL_ERRORS.signedOutPlain]);
  assert.equal('notes' in plain.card, false, 'the run card keeps its pinned key set');
  assert.deepEqual([calls.models.length, calls.auth, calls.engines], [0, 0, [{ projectDir: '/p/demo' }]], 'only the run engine is read (no catalog, no probe)');
  const codexProject = validator({ resolveEngine: () => 'codex' });
  assert.equal('notes' in (await codexProject.validateProposal(base, { claudeAuth: 'signed-out' })), false, 'a project whose runs default to Codex needs no Claude sign-in');
  const routedAll = Object.fromEntries(WF.nodes.filter((n) => n.kind === 'agent').map((n) => [n.id, { model: 'gw-coder' }]));
  const picked = await validateProposal({ ...base, nodes: routedAll }, { claudeAuth: 'signed-out' });
  assert.equal(picked.ok, true, JSON.stringify(picked));
  assert.equal('notes' in picked, false, 'a proposal naming a routed model for every agent node needs no note');
  const prev = process.env.WORCA_ASK_CLAUDE_AUTH;
  process.env.WORCA_ASK_CLAUDE_AUTH = 'signed-out';
  try {
    const child = validator({ claudeAuth: undefined });
    assert.deepEqual((await child.validateProposal(base)).notes, [PROPOSAL_ERRORS.signedOutPlain], 'the MCP child reads the hand-down');
  } finally {
    if (prev === undefined) delete process.env.WORCA_ASK_CLAUDE_AUTH; else process.env.WORCA_ASK_CLAUDE_AUTH = prev;
  }
});

test('signed out: another engine\'s model gets its engine error only (it never "needs the Claude Code sign-in"); a plain defragment proposal gets no note (nodes are refused there)', async () => {
  const { validateProposal } = validator({ claudeAuth: async () => 'signed-out' });
  const e = errs(await validateProposal({ ...base, nodes: { n_plan: { model: 'gpt-5.5' }, n_impl: { model: 'gw-coder' } } }));
  assert.deepEqual(e, ['node "n_plan": gpt-5.5 runs on Codex, not on Claude — pick a model this run\'s engine runs']);
  const defrag = await validateProposal({ ...base, workflowId: 'wf_memory_defrag', memoryScope: 'project' }, { claudeAuth: 'signed-out' });
  assert.equal(defrag.ok, true, JSON.stringify(defrag));
  assert.equal('notes' in defrag, false, 'the note asks for nodes, which the defragment workflow refuses');
});

test('the signed-out note says the plain card fails and that the re-proposal replaces it (the first card stays startable)', () => {
  assert.match(PROPOSAL_ERRORS.signedOutPlain, /a run of this card on Claude Code fails at its first agent/);
  assert.match(PROPOSAL_ERRORS.signedOutPlain, /tell the user the new card replaces this one/);
});

test('Copilot runs catalog models: a Claude pick on a Copilot run gets the per-node error', async () => {
  for (const [over, named] of [[{}, { engine: 'copilot' }], [{ resolveEngine: () => 'copilot' }, {}]]) {
    const { validateProposal } = validator(over);
    assert.deepEqual(errs(await validateProposal({ ...base, ...named, nodes: { n_plan: { model: 'claude-opus-5-5' }, n_impl: { model: 'claude-haiku-4-5', effort: 'high' } } })),
      ['node "n_plan": claude-opus-5-5 runs on Claude, not on Copilot — pick a model this run\'s engine runs',
        'node "n_impl": claude-haiku-4-5 runs on Claude, not on Copilot — pick a model this run\'s engine runs']);
  }
  // Codex runs catalog models: a Claude pick keeps its own per-node error there.
  const { validateProposal } = validator();
  assert.match(errs(await validateProposal({ ...base, engine: 'codex', nodes: { n_plan: { model: 'claude-opus-5-5' } } })).join('\n'), /claude-opus-5-5 runs on Claude, not on Codex/);
});
