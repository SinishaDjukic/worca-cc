// src/core/helper-call/cost.mjs — what one helper call cost, and what a step will cost (plans/requirements-9c-design.md D9, D14).
import * as config from '../config.mjs';
import { chatModelRates as realChatModelRates } from '../ask/chat-price.mjs';
import { chatDescriptor as realChatDescriptor } from '../engines/chat.mjs';
import { recentStepCosts as realRecentStepCosts, recentStepTokens as realRecentStepTokens } from '../requirements/store.mjs';

const median = (xs) => {
  const s = xs.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round4 = (n) => Math.round(n * 1e4) / 1e4;

/** The per-Mtok rates worca prices `model` at on `engine`, or null: Claude's live rates, else the chat engine's. */
export function ratesFor(engine, model, deps = {}) {
  const live = deps.liveCostRates || config.liveCostRates;
  if (!engine || engine === 'claude') return live(model);
  const rates = deps.chatModelRates || realChatModelRates;
  const descriptor = deps.chatDescriptor || realChatDescriptor;
  return rates(descriptor(engine), model);
}

const tokenOf = (usage, ...keys) => {
  if (!usage || typeof usage !== 'object') return null;
  for (const k of keys) if (usage[k] != null) return Number(usage[k]);
  return null;
};

/** What one result cost: billed (the harness reported it, re-priced by an override), estimated (priced from tokens) or unknown (0). */
export function costOfResult({ engine, model, event, rates }, deps = {}) {
  const resolve = deps.resolveModelCost || config.resolveModelCost;
  const priceable = deps.isPriceableUsage || config.isPriceableUsage;
  const estimate = deps.estimateCost || config.estimateCost;
  const ev = event || {};
  const usage = ev.usage ?? null;
  const tokens = { inputTokens: tokenOf(usage, 'input_tokens', 'input'), outputTokens: tokenOf(usage, 'output_tokens', 'output') };
  if (ev.costUsd != null) {
    const raw = Number(ev.costUsd);
    const cost = resolve(model, raw, usage);
    if (Number.isFinite(cost)) return { costUsd: cost, costKind: 'billed', ...tokens };
    // a price that cannot be applied (override without priceable usage) keeps the CLI's own figure, as today's Claude booking does
    if (Number.isFinite(raw)) return { costUsd: raw, costKind: 'billed', ...tokens };
    return { costUsd: 0, costKind: 'unknown', ...tokens };
  }
  if (rates && priceable(usage)) return { costUsd: estimate(usage, rates), costKind: 'estimated', ...tokens };
  return { costUsd: 0, costKind: 'unknown', ...tokens };
}

/** Two costs combined. Billed + estimated is estimated; an unknown part with no money is unknown; money beside an unknown part keeps its kind. */
export function addCost(a, b) {
  const parts = [a, b];
  const money = parts.filter((p) => p.costKind !== 'unknown');
  const unknownParts = parts.reduce((n, p) => n + (p.costKind === 'unknown' ? 1 : 0) + (p.unknownParts || 0), 0);
  if (!money.length) return { costUsd: 0, costKind: 'unknown' };
  const costKind = money.some((p) => p.costKind === 'estimated') ? 'estimated' : 'billed';
  const out = { costUsd: money.reduce((s, p) => s + p.costUsd, 0), costKind };
  if (unknownParts) out.unknownParts = unknownParts;
  return out;
}

/** What `step` ('look' | 'round' | 'brief') will cost on `model`: its own history, else typical token counts at the model's price. */
export function stepEstimate({ engine, model, step }, deps = {}) {
  const costs = deps.recentStepCosts || realRecentStepCosts;
  const tokens = deps.recentStepTokens || realRecentStepTokens;
  const rates = deps.ratesFor || ratesFor;
  if (!model) return { usd: null, reason: 'no-estimate' };
  const own = median(costs(step, { model }));
  if (own != null) return { usd: round4(own), kind: 'history' };
  const rows = tokens(step);
  const input = median(rows.map((r) => r.input));
  const output = median(rows.map((r) => r.output));
  if (input == null || output == null) return { usd: null, reason: 'no-estimate' };
  const priced = rates(engine, model);
  if (!priced) return { usd: null, reason: 'no-price' };
  return { usd: round4((deps.estimateCost || config.estimateCost)({ input_tokens: input, output_tokens: output }, priced)), kind: 'priced' };
}
