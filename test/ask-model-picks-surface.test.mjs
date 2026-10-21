// test/ask-model-picks-surface.test.mjs — what the Ask chat sees to pick per-agent models: the Models section of its
// system prompt (catalog facts, Ask only), rule 18's picking policy, list_models' facts and propose_run's `nodes`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import { buildSystemPrompt, buildComposerSystemPrompt, ASK_SYSTEM_RULES, codexSystemRules } from '../src/core/ask/prompt.mjs';
import { createCatalog } from '../src/core/ask/catalog.mjs';
import { createAskTools } from '../src/core/ask/tools.mjs';
import { modelFacts, MODEL_PICK_POLICY } from '../src/core/model-tiers.mjs';

useTempHome(after);
let sandboxHome;
const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-picks-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
});

const ROWS = [
  { id: 'gpt-5.5', label: 'GPT-5.5', efforts: ['minimal', 'low', 'medium', 'high'], harnesses: ['codex'], connection: { kind: 'signin', engine: 'codex' } },
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'], harnesses: ['claude'] },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'], harnesses: ['claude'], hidden: true },
];
const CAT = { projects: [], workspaces: [], workflows: [], models: modelFacts(ROWS) };

test('the Ask prompt lists the catalog\'s models with their picking facts — vendor order, hidden ones left out — and the composer never does', () => {
  const p = buildSystemPrompt(CAT);
  const at = p.indexOf('\n### Models (id "label": vendor · price tier · USD in/out per Mtok · prompt window · engines · efforts)\n');
  assert.ok(at > 0, 'the section');
  const opus = p.indexOf('\n- claude-opus-5-5 "Opus 5.5": anthropic · top tier · $4/$20 per Mtok · 1M context · runs on claude · efforts medium/high/xhigh/max\n');
  const gpt = p.indexOf('\n- gpt-5.5 "GPT-5.5": openai · top tier · $5/$30 per Mtok · 200k context · runs on codex · efforts minimal/low/medium/high\n');
  assert.ok(opus > at && gpt > opus, 'Anthropic first, then OpenAI');
  assert.equal(p.includes('claude-haiku-4-5'), false, 'a hidden model is never offered');
  assert.equal(buildSystemPrompt({ ...CAT, models: [...CAT.models].reverse() }), p, 'byte-stable under permutation');
  assert.equal(buildSystemPrompt({ projects: [], workspaces: [], workflows: [] }).includes('### Models'), false, 'no models, no section');
  assert.equal(buildComposerSystemPrompt(CAT).includes('### Models'), false, 'the Workflows chat prompt is unchanged');
  const many = modelFacts(Array.from({ length: ASK_LIMITS.catalogModelsMax + 2 }, (_, i) => ({ id: `gw-m${String(i).padStart(2, '0')}`, label: `M${i}`, efforts: [], harnesses: ['claude'] })));
  const big = buildSystemPrompt({ ...CAT, models: many });
  assert.equal((big.match(/\n- gw-m\d\d "/g) || []).length, ASK_LIMITS.catalogModelsMax);
  assert.ok(big.includes('\n- … 2 more — list_models has every model\n'), 'what the cap leaves out is said');
});

test('rule 18 carries the per-agent picking policy for propose_run nodes; the Codex rules still rewrite cleanly', () => {
  const at = ASK_SYSTEM_RULES.indexOf('\n18. Models and providers:');
  const next = ASK_SYSTEM_RULES.indexOf('\n19. People:');
  const sub = ASK_SYSTEM_RULES.indexOf('\n   - Per-agent models for one run (propose_run nodes):');
  assert.ok(at > 0 && sub > at && sub < next, 'a sub-bullet of rule 18');
  for (const phrase of [MODEL_PICK_POLICY, 'keyed by the node ids list_workflows returns (steps[].nodeId)', 'never with wf_auto',
    'name a model for every agent node', `at most ${ASK_LIMITS.proposalReasonMaxChars} characters`, 'comes back as a warning on the card',
    'A premium-tier pick comes back as a warning too: keep it only when the user named that model.']) {
    assert.ok(ASK_SYSTEM_RULES.includes(phrase), phrase.slice(0, 60));
  }
  assert.doesNotThrow(() => codexSystemRules());
});

test('the premium tier reaches every surface the chat picks from: the Models section, list_models\' tier scale and propose_run\'s warnings', () => {
  const p = buildSystemPrompt({ ...CAT, models: modelFacts([...ROWS, { id: 'claude-fable-5-1', label: 'Fable 5.1', efforts: ['high'], harnesses: ['claude'] }]) });
  assert.ok(p.includes('\n- claude-fable-5-1 "Fable 5.1": anthropic · premium tier · $10/$50 per Mtok · 1M context · runs on claude · efforts high\n'));
  const tools = createAskTools({ limits: ASK_LIMITS, redact: (s) => s, models: {} }).list();
  assert.match(tools.find((t) => t.name === 'list_models').description,
    /tier \(its price tier by output list price per million tokens: premium from \$40, top from \$20, strong from \$8, mid from \$2, else economy; null when unpriced\)/);
  assert.match(tools.find((t) => t.name === 'propose_run').description, /a card may carry warnings \(the team policy's allowed models, a premium-tier pick\) — relay them/);
});

test('createCatalog().buildCatalog carries the model facts; an unreadable catalog leaves them out, never the prompt', async () => {
  const base = { listProjects: async () => [], listWorkspaces: async () => [], listWorkflows: async () => [], loadAgentRegistry: () => ({}) };
  const cat = await createCatalog({ ...base, listModels: async () => [ROWS[1]], costOf: () => null }).buildCatalog();
  assert.deepEqual(cat.models.map((f) => [f.id, f.vendor, f.tier, f.context]), [['claude-opus-5-5', 'anthropic', 'top', 1_000_000]]);
  const broken = await createCatalog({ ...base, listModels: async () => { throw new Error('locked'); } }).buildCatalog();
  assert.deepEqual(broken.models, []);
});

test('list_models: every model, built-ins included, carries vendor, tier, price, free and context', async () => {
  const { listModelsForAsk } = await import('../src/core/ask/model-deps.mjs');
  const { models } = await listModelsForAsk();
  const pick = (m) => ({ vendor: m.vendor, tier: m.tier, price: m.price, free: m.free, context: m.context });
  assert.deepEqual(pick(models.find((m) => m.id === 'claude-opus-5-5')), { vendor: 'anthropic', tier: 'top', price: { input: 4, output: 20 }, free: false, context: 1_000_000 });
  assert.deepEqual(pick(models.find((m) => m.id === 'claude-sonnet-4-6[1m]')), { vendor: 'anthropic', tier: 'strong', price: { input: 3, output: 15 }, free: false, context: 1_000_000 });
  assert.deepEqual(pick(models.find((m) => m.id === 'gpt-5.5')), { vendor: 'openai', tier: 'top', price: { input: 5, output: 30 }, free: false, context: 200_000 });
  for (const m of models) for (const k of ['vendor', 'tier', 'price', 'free', 'context']) assert.ok(k in m, `${m.id}.${k}`);
  // A Copilot import (pinned Free only for recording): list_models says how it bills, never "free".
  const { factFields } = await import('../src/core/ask/model-deps.mjs');
  const [copilot] = modelFacts([{ id: 'copilot-claude-opus-4.5', label: 'Claude Opus 4.5 (Copilot)', efforts: [], harnesses: ['claude'], bridged: 'copilot',
    connection: { kind: 'provider', provider: 'copilot', api: 'anthropic', codex: false, prefer: 'claude' } }], { costOf: () => ({ free: true }) });
  assert.deepEqual(factFields(copilot), { vendor: 'anthropic', tier: null, price: null, free: false, context: 200_000, billing: 'copilot' });
  assert.equal('billing' in factFields(modelFacts([ROWS[1]])[0]), false);
  const tools = createAskTools({ limits: ASK_LIMITS, redact: (s) => s, models: {} });
  const desc = tools.list().find((t) => t.name === 'list_models').description;
  assert.match(desc, /vendor \(anthropic \| openai \| other/);
  assert.match(desc, /context \(its prompt window in tokens/);
  assert.match(desc, /billing "copilot"/);
});

test('propose_run takes nodes: per-node { model, effort?, subagentModel?, reason } keyed by node id; brief stays the only required key', () => {
  const tools = createAskTools({ limits: ASK_LIMITS, redact: (s) => s });
  const t = tools.list().find((x) => x.name === 'propose_run');
  assert.deepEqual(t.inputSchema.required, ['brief']);
  const nodes = t.inputSchema.properties.nodes;
  assert.equal(nodes.type, 'object');
  assert.deepEqual(Object.keys(nodes.additionalProperties.properties), ['model', 'effort', 'subagentModel', 'reason']);
  assert.deepEqual(nodes.additionalProperties.required, ['model']);
  assert.equal(nodes.additionalProperties.additionalProperties, false);
  assert.match(t.description, /nodes: per-agent model picks for this run only \(rule 18\)/);
});

test('rule 18 bars a model the Models section marks not ready (the run fails at that agent); list_models says a priced Copilot entry keeps its cost', () => {
  const sub = ASK_SYSTEM_RULES.slice(ASK_SYSTEM_RULES.indexOf('\n   - Pick from the Models section'), ASK_SYSTEM_RULES.indexOf('\n19. People:'));
  assert.ok(sub.includes('Never a model the Models section marks not ready (its provider is not set up: the run fails at that agent) unless the user asks for it.'));
  // The section really prints the words the rule names, for a model whose provider is not set up.
  const p = buildSystemPrompt({ projects: [], workspaces: [], workflows: [], models: modelFacts([
    { id: 'copilot-claude-opus-4.5', label: 'Opus (Copilot)', efforts: ['high'], harnesses: ['claude'], bridged: 'copilot', needsSignIn: true,
      connection: { kind: 'provider', provider: 'copilot', api: 'anthropic', codex: false, prefer: 'claude' } }]) });
  assert.match(p, /\n- copilot-claude-opus-4\.5 "Opus \(Copilot\)": [^\n]* · not ready\n/);
  assert.doesNotThrow(() => codexSystemRules());
  const desc = createAskTools({ limits: ASK_LIMITS, redact: (s) => s, models: {} }).list().find((t) => t.name === 'list_models').description;
  assert.match(desc, /with no price and no tier unless the entry sets its own cost\)/);
});
