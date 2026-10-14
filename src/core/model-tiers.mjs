// src/core/model-tiers.mjs
// The picking facts of every catalog model (docs/models.md "Per-agent models for one run"): who makes it, its price
// tier and list price, whether it is free and ready, its prompt window, the engines that run it and its efforts.
// ONE pure source for the Ask chat (list_models, the system prompt's Models section, the run card's per-agent picks)
// and the Auto classifier's model lines. Pure: the catalog rows (config.mjs listModels) and the cost-override reader
// (config.mjs modelCostConfig) are handed in; list prices come from the zero-import list-prices.mjs. Nothing here
// books a cost — resolveModelCost stays the one that does.
import { listPriceFor, CODEX_PRICES, LONG_PROMPT_PRICING } from './list-prices.mjs';
import { harnessesOf } from '../shared/connections.mjs';

/** Who makes a model, in picking order: Anthropic first, then OpenAI, then everyone else. */
export const VENDORS = Object.freeze(['anthropic', 'openai', 'other']);

/** Price tiers by the OUTPUT list price in USD per million tokens, strongest first; `min` is the tier's floor. */
export const TIERS = Object.freeze([
  Object.freeze({ id: 'top', rank: 1, min: 20 }),
  Object.freeze({ id: 'strong', rank: 2, min: 8 }),
  Object.freeze({ id: 'mid', rank: 3, min: 2 }),
  Object.freeze({ id: 'economy', rank: 4, min: 0 }),
]);

/** The window the claude CLI assumes for a model it knows no limit of (config.mjs resolveModelEnv's note). */
export const DEFAULT_CONTEXT_TOKENS = 200_000;
const ONE_M = 1_000_000;
// Built-ins that are 1M-only with no `[1m]` twin (config.mjs PREDEFINED_MODELS' comment); any `[1m]` id is 1M too.
// Opus 5's window is stated nowhere in the code, so it keeps the default.
const ONE_M_BUILTINS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);

/** How to pick a model per agent step — ONE text for the Ask rules (prompt.mjs rule 18) and the Auto classifier's
 *  tuning guide. Stages by display name only: the Ask rules may not name an agent key. */
export const MODEL_PICK_POLICY = 'Judgement steps (Plan, Plan Review, Refine Plan, Review Implementation, Bug Root Cause, Deck Review) take the top tier at high effort; producers that design (Implementation, Bug Fix, Deck Builder) the strong tier at medium or high effort by the size of the task; mechanical producers (Decompose, Manual Tests Checklist, Bug Report Analysis, Deck Export, Bug Triage Report) the cheapest capable tier at medium effort; tool-driven verifiers (Manual web UI testing, visual checks) the mid tier, with tool calls and vision; any other step (Clarify included) the strong tier at medium effort. Scale the tiers down with the weight of the task: a one-file fix never needs the top tier on Implementation. Prefer Anthropic models, then OpenAI, then others, only among the models the run\'s engine runs. A free model only on a low-risk producer step, only when it is ready, has tool calls and at least a 64k context, and never on a judgement step or as the only Implementation step. A 1M-context twin only when the context demands it. A model without a tier (no token price: a Copilot import, an unpriced provider entry) ranks as the model it serves, judged by its name.';

// The maker, from a model NAME (the upstream id when the entry has one, else the catalog id): a family word as its own token.
const ANTHROPIC_RE = /(^|[^a-z0-9])(anthropic|claude|opus|sonnet|haiku|fable)(?![a-z])/;
const OPENAI_RE = /(^|[^a-z0-9])(openai|chatgpt|gpt|codex|o[1-9])(?![a-z])/;

function vendorOf(row) {
  // An upstream id alone decides (a gateway alias like "sonnet-fast" may serve GLM): no family word there is `other`.
  const up = typeof row.upstreamModel === 'string' ? row.upstreamModel.trim().toLowerCase() : '';
  const name = up || row.id.toLowerCase();
  if (ANTHROPIC_RE.test(name)) return 'anthropic';
  if (OPENAI_RE.test(name)) return 'openai';
  if (up) return 'other';
  // No family word: a harness's own sign-in names its maker (a raw id the claude CLI runs on its login is Claude's).
  const c = row.connection && typeof row.connection === 'object' ? row.connection : null;
  if (c && c.kind === 'signin') return c.engine === 'claude' ? 'anthropic' : c.engine === 'codex' ? 'openai' : 'other';
  return 'other';
}

// A GitHub Copilot entry bills premium requests, not tokens: an import pins it Free only so recorded spend reads $0
// (docs/models.md "Cost and quota"). It is neither a free model nor an economy one — it has no per-token price.
const COPILOT_BILLED = (row) => row.bridged === 'copilot'
  || !!(row.connection && typeof row.connection === 'object' && row.connection.kind === 'provider' && row.connection.provider === 'copilot');

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const baseId = (id) => id.toLowerCase().replace(/\[1m\]$/, '').replace(/-\d{8}$/, '');

/** USD per million tokens { input, output }, or null: the entry's own cost first (free = 0/0), else the list price
 *  (Anthropic built-ins — `[1m]` twins and dated ids on their base row — and Codex built-ins). The precedence of
 *  config.mjs liveCostRates; inherited names (`constructor`) are never a price row. */
function priceOf(id, cost) {
  if (cost && cost.free === true) return { input: 0, output: 0 };
  if (cost && cost.perMtok && typeof cost.perMtok === 'object') {
    const p = { input: finite(cost.perMtok.input), output: finite(cost.perMtok.output) };
    return p.input === null && p.output === null ? null : p;
  }
  const list = listPriceFor(id);
  if (list && typeof list === 'object' && finite(list.output) !== null) return { input: finite(list.input), output: list.output };
  const lc = id.toLowerCase();
  const cx = Object.hasOwn(CODEX_PRICES, lc) ? CODEX_PRICES[lc] : null;
  return Array.isArray(cx) ? { input: finite(cx[0]), output: finite(cx[1]) } : null;
}

const tierOf = (price) => (price && price.output !== null ? TIERS.find((t) => price.output >= t.min) || null : null);

function contextOf(row) {
  const caps = row.capabilities && typeof row.capabilities === 'object' ? row.capabilities : {};
  if (Number.isInteger(caps.maxPromptTokens) && caps.maxPromptTokens > 0) return { tokens: caps.maxPromptTokens, from: 'capabilities' };
  if (/\[1m\]$/i.test(row.id) || ONE_M_BUILTINS.has(baseId(row.id))) return { tokens: ONE_M, from: 'built-in' };
  return { tokens: DEFAULT_CONTEXT_TOKENS, from: 'default' };
}

/**
 * The picking facts of every catalog row (config.mjs listModels rows: id, label, efforts, connection, harnesses,
 * bridged/upstreamModel, needsSignIn, capabilities, hidden). Rows without a string id are skipped; never throws.
 * @param {object[]} rows
 * @param {{costOf?: (id: string) => ({free:true}|{perMtok:object}|null)}} [opts] the entry's own cost (modelCostConfig)
 * @returns {Array<{id:string, label:string, vendor:string, tier:string|null, tierRank:number|null,
 *   price:{input:number|null, output:number|null}|null, free:boolean, ready:boolean, context:number,
 *   contextFrom:'capabilities'|'built-in'|'default', engines:string[], efforts:string[], toolCalls:boolean,
 *   vision:boolean, hidden?:true, billing?:'copilot', longPrompt?:{aboveTokens:number, multiplier:number}}>}
 */
export function modelFacts(rows, { costOf = () => null } = {}) {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id) continue;
    let cost = null;
    try { cost = costOf(row.id) || null; } catch { cost = null; }
    const copilot = COPILOT_BILLED(row);
    if (copilot && cost && cost.free === true) cost = null;   // the recording pin, not a price
    const price = priceOf(row.id, cost);
    const tier = tierOf(price);
    const ctx = contextOf(row);
    const base = baseId(row.id);
    const lp = !cost && Object.hasOwn(LONG_PROMPT_PRICING, base) ? LONG_PROMPT_PRICING[base] : null;
    const caps = row.capabilities && typeof row.capabilities === 'object' ? row.capabilities : {};
    out.push({
      id: row.id,
      label: typeof row.label === 'string' && row.label ? row.label : row.id,
      vendor: vendorOf(row),
      tier: tier ? tier.id : null,
      tierRank: tier ? tier.rank : null,
      price,
      free: (!!cost && cost.free === true) || (!!price && price.input === 0 && price.output === 0),
      ready: !row.needsSignIn,
      context: ctx.tokens,
      contextFrom: ctx.from,
      engines: [...harnessesOf(row)],
      efforts: Array.isArray(row.efforts) ? row.efforts.filter((e) => typeof e === 'string') : [],
      toolCalls: caps.toolCalls !== false,
      vision: caps.vision !== false,
      ...(row.hidden ? { hidden: true } : {}),
      ...(copilot ? { billing: 'copilot' } : {}),
      ...(lp ? { longPrompt: { aboveTokens: lp.aboveTokens, multiplier: lp.multiplier } } : {}),
    });
  }
  return out;
}

/** Picking order: vendor (VENDORS), then tier, then the cheaper output price, then id — byte-stable for the prompt. */
export function compareFacts(a, b) {
  const v = VENDORS.indexOf(a.vendor) - VENDORS.indexOf(b.vendor);
  if (v) return v;
  const r = (a.tierRank ?? 9) - (b.tierRank ?? 9);
  if (r) return r;
  const pa = a.price && a.price.output !== null ? a.price.output : Infinity;
  const pb = b.price && b.price.output !== null ? b.price.output : Infinity;
  if (pa !== pb) return pa < pb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const num = (n) => String(Math.round(n * 1000) / 1000);
/** "$4/$20 per Mtok" ("?" for a missing side), or "no list price". */
export function priceText(price) {
  if (!price) return 'no list price';
  const side = (v) => (v === null || v === undefined ? '?' : `$${num(v)}`);
  return `${side(price.input)}/${side(price.output)} per Mtok`;
}
/** "1M", "200k". */
export function contextText(tokens) {
  if (!Number.isFinite(tokens) || tokens <= 0) return '?';
  return tokens >= ONE_M ? `${num(tokens / ONE_M)}M` : `${Math.round(tokens / 1000)}k`;
}
/** The short facts (the Auto classifier's model lines): "anthropic · top tier · $4/$20 per Mtok" (+ " · free"). */
export function factsBrief(f) {
  if (!f || typeof f !== 'object') return '';
  const parts = [f.vendor];
  if (f.price) parts.push(f.tier ? `${f.tier} tier` : 'unranked', priceText(f.price));
  else parts.push(f.billing === 'copilot' ? 'billed as Copilot premium requests (no token price)' : 'no list price');
  if (f.free) parts.push('free');
  return parts.join(' · ');
}
/** The whole line (the Ask Models section, the run card's hover): brief · window · engines · efforts · flags. */
export function factsLine(f) {
  if (!f || typeof f !== 'object') return '';
  const engines = Array.isArray(f.engines) && f.engines.length ? f.engines.join('/') : 'no engine';
  const parts = [factsBrief(f), `${contextText(f.context)} context`, `runs on ${engines}`];
  if (Array.isArray(f.efforts) && f.efforts.length) parts.push(`efforts ${f.efforts.join('/')}`);
  if (f.ready === false) parts.push('not ready');
  if (f.toolCalls === false) parts.push('no tool calls');
  if (f.vision === false) parts.push('no vision');
  if (f.longPrompt) parts.push(`prompts over ${contextText(f.longPrompt.aboveTokens)} cost ${f.longPrompt.multiplier}×`);
  return parts.join(' · ');
}
