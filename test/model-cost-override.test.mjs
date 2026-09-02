// test/model-cost-override.test.mjs
// Opt-in per-model cost override (config.mjs): a user-pinned {free}/{perMtok}
// entry in the GLOBAL catalog wins over whatever total_cost_usd the Claude CLI
// fabricates for an on-prem/proxied model. Inspired by worca 0.x cost_alias.
// Mirrors test/model-cost-flags.test.mjs sandboxing (sandboxed HOME + WORCA_HOME
// + the catalog test-guard opt-in, plus a DB reset since observeModelCost writes).
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  modelCostConfig, estimateCost, isPriceableUsage, resolveModelCost,
  observeModelCost, costUnreliableModelIds,
  liveCostRates, PREDEFINED_LIST_PRICES, PREDEFINED_MODELS,
} from '../src/core/config.mjs';
import { addGlobalModel, updateGlobalModel } from '../src/core/settings.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { getDb, _resetForTests } from '../src/core/db.mjs';

const dirs = [];
const prevEnv = {
  HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME,
  WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK,
};
beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-mco-home-'));
  const whome = await mkdtemp(join(tmpdir(), 'worca-cc-mco-whome-'));
  dirs.push(home, whome);
  _resetForTests();
  process.env.HOME = home; process.env.USERPROFILE = home;
  process.env.WORCA_HOME = whome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
after(async () => {
  _resetForTests();
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

const USAGE = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 };

test('modelCostConfig: reads the GLOBAL catalog override, null when none / unknown', async () => {
  await addGlobalModel({ id: 'onprem', cost: { free: true } });
  await addGlobalModel({ id: 'plain' });
  assert.deepEqual(modelCostConfig('ONPREM'), { free: true }, 'case-insensitive');
  assert.equal(modelCostConfig('plain'), null);
  assert.equal(modelCostConfig('claude-opus-5'), null, 'predefined carry none');
  assert.equal(modelCostConfig(''), null);
});

test('estimateCost: rates are USD per MILLION tokens; missing rates/usage count as 0', () => {
  // 1M of each class at 1.0/mtok = 1.0 apiece.
  assert.equal(estimateCost(USAGE, { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 }), 4);
  assert.equal(estimateCost(USAGE, { output: 2 }), 2, 'only output priced');
  assert.equal(estimateCost({ input_tokens: 500_000 }, { input: 3 }), 1.5);
  assert.equal(estimateCost({}, { input: 5 }), 0);
  assert.equal(estimateCost(USAGE, {}), 0, 'no rates → $0');
  assert.equal(estimateCost(USAGE, null), 0);
});

test('estimateCost: ephemeral 1h/5m cache buckets price separately, else flat cacheWrite', () => {
  const u = { cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 1_000_000 } };
  assert.equal(estimateCost(u, { cacheWrite: 1, cacheWrite1h: 2 }), 3, '5m@1 + 1h@2');
  assert.equal(estimateCost(u, { cacheWrite: 1 }), 2, '1h falls back to cacheWrite when cacheWrite1h absent');
  // No bucket breakdown → flat cache_creation_input_tokens at cacheWrite.
  assert.equal(estimateCost({ cache_creation_input_tokens: 2_000_000 }, { cacheWrite: 1 }), 2);
});

test('resolveModelCost: no override → CLI value verbatim (incl. NaN passthrough)', async () => {
  await addGlobalModel({ id: 'plain' });
  assert.equal(resolveModelCost('plain', 0.4625, USAGE), 0.4625);
  assert.equal(resolveModelCost('unknown-model', 1.23, USAGE), 1.23);
  assert.ok(Number.isNaN(resolveModelCost('plain', NaN, USAGE)));
});

test('resolveModelCost: {free} → $0 regardless of what the CLI reported', async () => {
  await addGlobalModel({ id: 'onprem', env: { ANTHROPIC_BASE_URL: 'https://p' }, cost: { free: true } });
  assert.equal(resolveModelCost('onprem', 0.4625, USAGE), 0, 'the reported 0.46 is discarded');
  assert.equal(resolveModelCost('ONPREM', 99, USAGE), 0, 'case-insensitive');
  assert.equal(resolveModelCost('onprem', NaN, USAGE), 0, 'free is 0 even when CLI reported nothing');
});

test('resolveModelCost: {perMtok} → recomputed from tokens, ignoring the CLI value', async () => {
  await addGlobalModel({ id: 'priced', cost: { perMtok: { input: 1, output: 3 } } });
  // 1M input @1 + 1M output @3 = 4, no matter what the CLI said.
  assert.equal(resolveModelCost('priced', 999, USAGE), 4);
});

test('estimateCost also reads Ask Worca\'s normalized usage shape (same tokens, other spelling)', () => {
  const rates = { input: 1, output: 3, cacheRead: 0.1, cacheWrite: 1.25 };
  const ask = { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheCreation: 1_000_000, ctx: 4_000_000 };
  assert.equal(estimateCost(ask, rates), estimateCost(USAGE, rates), 'both spellings price identically');
  assert.equal(estimateCost({ input: 500_000 }, { input: 3 }), 1.5);
  // The raw spelling wins when (impossibly) both are present — it is the source shape.
  assert.equal(estimateCost({ input_tokens: 1_000_000, input: 9_000_000 }, { input: 1 }), 1);
  // A raw ZERO is a real count, not a gap: it must not fall through to the camel key.
  assert.equal(estimateCost({ input_tokens: 0, input: 9_000_000 }, { input: 1 }), 0);
});

test('isPriceableUsage: an absent usage object is unpriceable; genuine zeroes are priceable', () => {
  assert.equal(isPriceableUsage(undefined), false);
  assert.equal(isPriceableUsage(null), false);
  assert.equal(isPriceableUsage('nope'), false);
  assert.equal(isPriceableUsage({}), false, 'an object with no token fields says nothing');
  assert.equal(isPriceableUsage({ input_tokens: 0 }), true, 'zero tokens IS a count');
  assert.equal(isPriceableUsage({ output: 0 }), true, 'the ask spelling counts too');
  assert.equal(isPriceableUsage({ cache_creation: { ephemeral_1h_input_tokens: 5 } }), true);
});

test('resolveModelCost: {perMtok} with NO usage is NaN — never a silent $0, never the CLI figure', async () => {
  await addGlobalModel({ id: 'priced', cost: { perMtok: { input: 1, output: 3 } } });
  assert.ok(Number.isNaN(resolveModelCost('priced', 0.4625, undefined)),
    'unpriceable: the caller reports it instead of booking a made-up number');
  assert.ok(Number.isNaN(resolveModelCost('priced', 0.4625, null)));
  assert.equal(resolveModelCost('priced', 0.4625, { input_tokens: 0, output_tokens: 0 }), 0,
    'but a usage object of genuine zeroes prices at $0');
  // {free} needs no usage at all — it is $0 by decree.
  await addGlobalModel({ id: 'onprem', cost: { free: true } });
  assert.equal(resolveModelCost('onprem', 0.4625, undefined), 0);
});

test('resolveModelCost / observeModelCost accept a pre-resolved override (one catalog read per event)', async () => {
  await addGlobalModel({ id: 'onprem', env: { ANTHROPIC_BASE_URL: 'https://p' }, cost: { free: true } });
  // An explicitly passed config is USED — including `null`, which means "checked,
  // there is none" and must not trigger a second lookup that finds one.
  assert.equal(resolveModelCost('onprem', 0.4625, USAGE, { free: true }), 0);
  assert.equal(resolveModelCost('onprem', 0.4625, USAGE, null), 0.4625,
    'null = the caller already established there is no override');
  assert.equal(resolveModelCost('onprem', 0.4625, USAGE), 0, 'undefined = look it up');
  // Same contract on the observer: a passed-in override suppresses the flag.
  assert.equal(observeModelCost('onprem', 0, USAGE, { free: true }), null);
  assert.equal(observeModelCost('onprem', 0, USAGE, null), 'flagged',
    'told there is no override, it flags the zero-cost-with-tokens run as before');
});

test('observeModelCost: a model with an override is never flagged and its stale flag is lifted', async () => {
  // A routed model with NO override reports zero cost with tokens → flagged.
  await addGlobalModel({ id: 'onprem', env: { ANTHROPIC_BASE_URL: 'https://p' } });
  assert.equal(observeModelCost('onprem', 0, USAGE), 'flagged');
  assert.deepEqual([...costUnreliableModelIds()], ['onprem']);

  // Add an override to that SAME model, then observe again: never flags, and the
  // stale flag from before the override existed is lifted.
  await updateGlobalModel('onprem', { cost: { free: true } });
  assert.equal(observeModelCost('onprem', 0, USAGE), null, 'never flagged with an override');
  assert.equal(costUnreliableModelIds().size, 0, 'stale flag lifted');
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM model_cost_flags').get().n, 0);
});

// ── end-to-end through the orchestrator's result-event intake ───────────────────

test('orchestrator: a {free} model records $0 for the step and total, discarding the CLI figure', async () => {
  await addGlobalModel({ id: 'onprem', env: { ANTHROPIC_BASE_URL: 'https://p' }, cost: { free: true } });
  const orch = createOrchestrator({ projectDir: join(tmpdir(), 'mco-proj') });
  orch._phase('plan', 0, 'start');
  orch._onAgentEvent('planner',
    { type: 'result', costUsd: 0.4625, raw: { type: 'result', total_cost_usd: 0.4625, usage: USAGE } },
    { model: 'onprem', stepKey: 'plan' });
  const st = orch.getState();
  assert.equal(st.steps.find((s) => s.key === 'plan').costUsd, 0, 'the fabricated 0.4625 is discarded');
  assert.equal(st.totalCostUsd, 0);
});

test('orchestrator: with no override the CLI figure is recorded unchanged', async () => {
  await addGlobalModel({ id: 'plain', env: { ANTHROPIC_BASE_URL: 'https://p' } });
  const orch = createOrchestrator({ projectDir: join(tmpdir(), 'mco-proj2') });
  orch._phase('plan', 0, 'start');
  orch._onAgentEvent('planner',
    { type: 'result', costUsd: 0.4625, raw: { type: 'result', usage: USAGE } },
    { model: 'plain', stepKey: 'plan' });
  assert.equal(orch.getState().totalCostUsd, 0.4625);
});

test('orchestrator: a {perMtok} model records the recomputed cost, not the CLI figure', async () => {
  await addGlobalModel({ id: 'priced', env: { ANTHROPIC_BASE_URL: 'https://p' }, cost: { perMtok: { input: 1, output: 3 } } });
  const orch = createOrchestrator({ projectDir: join(tmpdir(), 'mco-proj3') });
  orch._phase('plan', 0, 'start');
  orch._onAgentEvent('planner',
    { type: 'result', costUsd: 999, raw: { type: 'result', usage: USAGE } },
    { model: 'priced', stepKey: 'plan' });
  assert.equal(orch.getState().totalCostUsd, 4, '1M input@1 + 1M output@3');
});

test('liveCostRates: built-ins price from the list table; [1m]/dated ids share the base row; unknown → null', () => {
  assert.deepEqual(liveCostRates('claude-opus-5'), PREDEFINED_LIST_PRICES['claude-opus-5']);
  assert.equal(liveCostRates('claude-opus-5').input, 5);
  assert.equal(liveCostRates('claude-fable-5-1').cacheRead, 0.25, 'Fable 5.1 cache reads are 0.025× input');
  assert.deepEqual(liveCostRates('claude-opus-4-8[1m]'), PREDEFINED_LIST_PRICES['claude-opus-4-8'], '[1m] twin → base row');
  assert.deepEqual(liveCostRates('claude-haiku-4-5-20251001'), PREDEFINED_LIST_PRICES['claude-haiku-4-5'], 'dated id → base row');
  assert.deepEqual(liveCostRates('CLAUDE-SONNET-5'), PREDEFINED_LIST_PRICES['claude-sonnet-5'], 'case-insensitive');
  assert.equal(liveCostRates('onprem-llama'), null, 'unknown id: no estimate (today\'s behaviour)');
  assert.equal(liveCostRates(''), null);
  assert.equal(liveCostRates(undefined), null);
  // every id the picker offers has a row — or the footer silently shows nothing for it
  for (const m of PREDEFINED_MODELS) assert.ok(liveCostRates(m.id), `${m.id} has list prices`);
  assert.equal(modelCostConfig('claude-opus-5'), null, 'the display table never leaks into the authoritative override');
  assert.equal(estimateCost({ input: 1_000_000, output: 1_000_000 }, liveCostRates('claude-opus-5')), 30, '$5 + $25');
});

test('liveCostRates: an operator override wins — {free} prices at $0, {perMtok} uses the pinned rates', async () => {
  await addGlobalModel({ id: 'claude-opus-5', cost: { free: true } });   // a global entry may shadow a predefined id
  assert.deepEqual(liveCostRates('claude-opus-5'), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 });
  await addGlobalModel({ id: 'onprem', cost: { perMtok: { input: 0.5, output: 1.5 } } });
  assert.deepEqual(liveCostRates('onprem'), { input: 0.5, output: 1.5 });
  assert.equal(estimateCost({ input: 1_000_000, output: 1_000_000 }, liveCostRates('onprem')), 2);
});
