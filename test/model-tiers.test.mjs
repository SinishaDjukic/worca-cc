// test/model-tiers.test.mjs — the picking facts of every catalog model (src/core/model-tiers.mjs): vendor, price tier,
// list price, free, ready, prompt window, engines and efforts — one pure source for Ask and the Auto classifier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  modelFacts, factsBrief, factsLine, compareFacts, TIERS, VENDORS, DEFAULT_CONTEXT_TOKENS, MODEL_PICK_POLICY,
} from '../src/core/model-tiers.mjs';

const CLAUDE = { kind: 'signin', engine: 'claude' };
const CODEX = { kind: 'signin', engine: 'codex' };
const row = (id, extra = {}) => ({ id, label: id, efforts: ['medium', 'high'], engine: 'claude', connection: CLAUDE, harnesses: ['claude'], ...extra });
const codex = (id) => row(id, { engine: 'codex', connection: CODEX, harnesses: ['codex'], efforts: ['minimal', 'low', 'medium', 'high'] });

test('built-ins: vendor from the id, the price tier from the output list price, the known 1M windows', () => {
  const [opus, fable, sonnet, haiku55, haiku45, twin, gpt, spark, astra] = modelFacts([
    row('claude-opus-5-5'), row('claude-fable-5-1'), row('claude-sonnet-5-5'), row('claude-haiku-5-5'), row('claude-haiku-4-5'),
    row('claude-opus-4-8[1m]'), codex('gpt-5.6-terra'), codex('gpt-5.3-codex-spark'), codex('gpt-6-astra'),
  ]);
  assert.deepEqual(opus, {
    id: 'claude-opus-5-5', label: 'claude-opus-5-5', vendor: 'anthropic', tier: 'top', tierRank: 2,
    price: { input: 4, output: 20 }, free: false, ready: true, context: 1_000_000, contextFrom: 'built-in',
    engines: ['claude'], efforts: ['medium', 'high'], toolCalls: true, vision: true,
  });
  assert.deepEqual([fable.tier, fable.tierRank, fable.price], ['premium', 1, { input: 10, output: 50 }], 'Fable 5.1 lists at $50 output: above the top tier');
  assert.equal(sonnet.tier, 'strong');
  assert.deepEqual([haiku55.tier, haiku55.price, haiku55.longPrompt], ['economy', { input: 0.1, output: 0.5 }, { aboveTokens: 100_000, multiplier: 5 }]);
  assert.deepEqual([haiku45.tier, haiku45.context, haiku45.contextFrom], ['mid', DEFAULT_CONTEXT_TOKENS, 'default']);
  assert.deepEqual([twin.price, twin.tier, twin.context], [{ input: 5, output: 25 }, 'top', 1_000_000], 'a [1m] twin shares its base row');
  assert.deepEqual([gpt.vendor, gpt.tier, gpt.price, gpt.engines, gpt.efforts], ['openai', 'strong', { input: 2, output: 12 }, ['codex'], ['minimal', 'low', 'medium', 'high']]);
  assert.equal(spark.tier, 'mid');
  assert.deepEqual([astra.tier, astra.price], ['premium', { input: 10, output: 50 }], 'GPT-6 Astra at $50 output is premium');
  assert.deepEqual(TIERS.map((t) => [t.id, t.rank, t.min]), [['premium', 1, 40], ['top', 2, 20], ['strong', 3, 8], ['mid', 4, 2], ['economy', 5, 0]]);
  assert.deepEqual(VENDORS, ['anthropic', 'openai', 'other']);
});

test('user, plugin and bridged entries: the entry\'s own cost wins over the list, free prices 0/0, readiness and the pinned window', () => {
  const PROVIDER = { kind: 'provider', provider: 'openai', api: 'openai-chat', codex: false, prefer: 'claude' };
  const costs = { 'or-qwen-free': { free: true }, 'or-deepseek': { perMtok: { input: 0.3, output: 1.2 } }, 'claude-opus-5-5': { perMtok: { input: 1, output: 2 } } };
  const [free, ds, shadow, proxy, alias] = modelFacts([
    row('or-qwen-free', { connection: PROVIDER, bridged: 'openai', upstreamModel: 'qwen/qwen3-coder:free', needsSignIn: true,
      capabilities: { maxPromptTokens: 131072, toolCalls: true, vision: false } }),
    row('or-deepseek', { connection: PROVIDER, bridged: 'openai', upstreamModel: 'deepseek/deepseek-v3.2', capabilities: { maxPromptTokens: 65536, toolCalls: false } }),
    row('claude-opus-5-5'),
    row('gw-sonnet', { connection: { kind: 'provider', provider: 'anthropic', api: 'anthropic', codex: false, prefer: 'claude' },
      bridged: 'anthropic', upstreamModel: 'anthropic/claude-sonnet-4.5' }),
    row('sonnet-fast', { connection: PROVIDER, bridged: 'openai', upstreamModel: 'z-ai/glm-4.6' }),
  ], { costOf: (id) => costs[id] || null });
  assert.deepEqual([free.vendor, free.free, free.price, free.tier, free.ready, free.context, free.contextFrom, free.toolCalls, free.vision],
    ['other', true, { input: 0, output: 0 }, 'economy', false, 131072, 'capabilities', true, false]);
  assert.deepEqual([ds.price, ds.tier, ds.free, ds.toolCalls, ds.context], [{ input: 0.3, output: 1.2 }, 'economy', false, false, 65536]);
  assert.deepEqual([shadow.price, shadow.tier, 'longPrompt' in shadow], [{ input: 1, output: 2 }, 'mid', false], 'an override prices the id, never the list');
  assert.deepEqual([proxy.vendor, proxy.price, proxy.tier, proxy.tierRank], ['anthropic', null, null, null], 'the upstream id names the maker; no list price, no tier');
  assert.equal(alias.vendor, 'other', 'the upstream id alone decides: a "sonnet" alias serving GLM is not Anthropic\'s');
});

test('compareFacts: Anthropic, OpenAI, then others; then tier; then the cheaper output price; factsBrief/factsLine read on one line', () => {
  const facts = modelFacts([codex('gpt-5.6-terra'), row('local-coder', { connection: { kind: 'env' } }), row('claude-haiku-4-5'), row('claude-fable-5-1'), row('claude-opus-5-5')]);
  assert.deepEqual([...facts].sort(compareFacts).map((f) => f.id), ['claude-fable-5-1', 'claude-opus-5-5', 'claude-haiku-4-5', 'gpt-5.6-terra', 'local-coder'],
    'tiers strongest first: premium before top');
  const by = Object.fromEntries(facts.map((f) => [f.id, f]));
  assert.equal(factsBrief(by['claude-fable-5-1']), 'anthropic · premium tier · $10/$50 per Mtok');
  assert.equal(factsBrief(by['claude-opus-5-5']), 'anthropic · top tier · $4/$20 per Mtok');
  assert.equal(factsLine(by['claude-opus-5-5']), 'anthropic · top tier · $4/$20 per Mtok · 1M context · runs on claude · efforts medium/high');
  assert.equal(factsBrief(by['local-coder']), 'other · no list price');
  assert.equal(factsLine(by['gpt-5.6-terra']), 'openai · strong tier · $2/$12 per Mtok · 200k context · runs on codex · efforts minimal/low/medium/high');
  const [haiku55] = modelFacts([row('claude-haiku-5-5')]);
  assert.match(factsLine(haiku55), / · prompts over 100k cost 5×$/);
  const [free] = modelFacts([row('gw-free', { connection: { kind: 'env' }, needsSignIn: true })], { costOf: () => ({ free: true }) });
  assert.equal(factsLine(free), 'other · economy tier · $0/$0 per Mtok · free · 200k context · runs on claude · efforts medium/high · not ready');
});

test('junk rows and a throwing cost reader never throw; inherited names get no list price', () => {
  const facts = modelFacts([null, {}, { id: 5 }, { id: '' }, { id: 'constructor' }, { id: '__proto__', capabilities: { maxPromptTokens: -1 } }, { id: 'toString', efforts: 'high' }],
    { costOf: () => { throw new Error('settings unreadable'); } });
  assert.deepEqual(facts.map((f) => [f.id, f.price, f.tier, f.context, f.efforts, f.vendor]), [
    ['constructor', null, null, DEFAULT_CONTEXT_TOKENS, [], 'other'],
    ['__proto__', null, null, DEFAULT_CONTEXT_TOKENS, [], 'other'],
    ['toString', null, null, DEFAULT_CONTEXT_TOKENS, [], 'other'],
  ]);
  assert.deepEqual(modelFacts(undefined), []);
});

test('MODEL_PICK_POLICY names stages by display name only — the Ask rules may not hardcode agent keys', () => {
  for (const stage of ['Plan Review', 'Refine Plan', 'Review Implementation', 'Bug Root Cause', 'Deck Review', 'Implementation', 'Bug Fix', 'Deck Builder', 'Decompose', 'Manual Tests Checklist', 'Bug Report Analysis', 'Deck Export', 'Bug Triage Report', 'Manual web UI testing']) {
    assert.ok(MODEL_PICK_POLICY.includes(stage), stage);
  }
  for (const key of ['implementer', 'planner', 'refiner', 'reviewer', 'clarify', 'decomposer']) assert.equal(MODEL_PICK_POLICY.includes(key), false, key);
  assert.match(MODEL_PICK_POLICY, /Prefer Anthropic models, then OpenAI, then others/);
  assert.match(MODEL_PICK_POLICY, /at least a 64k context/);
  assert.match(MODEL_PICK_POLICY, /any other step \(Clarify included\) the strong tier at medium effort/, 'every wf_default run has a Clarify step');
});

test('MODEL_PICK_POLICY is conservative: judgement takes the top tier, never premium; the cheapest capable model within a tier; premium only when named', () => {
  assert.match(MODEL_PICK_POLICY, /^Judgement steps \(Plan, Plan Review, Refine Plan, Review Implementation, Bug Root Cause, Deck Review\) take the top tier \(never the premium tier\) at high effort;/);
  assert.match(MODEL_PICK_POLICY, /Within a tier take the cheapest capable model\./);
  assert.match(MODEL_PICK_POLICY, /Never pick a premium-tier model unless the user names that model\./);
  assert.equal(TIERS[0].id, 'premium', 'the policy\'s premium tier is the one the facts carry');
});

test('a Copilot import is pinned Free only for recording (Copilot bills premium requests): never a free, economy-tier model', () => {
  const COPILOT = { kind: 'provider', provider: 'copilot', api: 'anthropic', codex: false, prefer: 'claude' };
  const [opus] = modelFacts([row('copilot-claude-opus-4.5', { connection: COPILOT, bridged: 'copilot', upstreamModel: 'claude-opus-4.5',
    capabilities: { maxPromptTokens: 128000, toolCalls: true, vision: true } })], { costOf: () => ({ free: true }) });
  assert.deepEqual([opus.vendor, opus.free, opus.price, opus.tier, opus.billing], ['anthropic', false, null, null, 'copilot']);
  assert.equal(factsBrief(opus), 'anthropic · billed as Copilot premium requests (no token price)');
  assert.doesNotMatch(factsLine(opus), /free|economy/);
  assert.match(MODEL_PICK_POLICY, /A model without a tier \(no token price: a Copilot import, an unpriced provider entry\) ranks as the model it serves/);
  const [local] = modelFacts([row('ollama-qwen', { connection: { kind: 'provider', provider: 'openai', api: 'openai-chat', codex: false, prefer: 'claude' }, bridged: 'openai', upstreamModel: 'qwen3-coder' })],
    { costOf: () => ({ free: true }) });
  assert.deepEqual([local.free, local.tier], [true, 'economy'], 'a local model stays a free one');
});
