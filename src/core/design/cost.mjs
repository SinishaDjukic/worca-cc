// src/core/design/cost.mjs — one Design agent's dollars, worca's caps for a build, and the per-process budget flag
// (Design P2 Task 5). Design has no spending limit of its own (M13): a round counts toward the per-run cap and the
// total limit the person set for worca in Settings, read through the same fold runs use.
import { priceUsage, usageTokens } from '../session-cost.mjs';
import { liveCostRates, modelCostConfig, modelHasBaseUrlRouting, resolveModelCost } from '../config.mjs';
import { HOST_BUDGET_IS_CUMULATIVE } from '../session-host.mjs';
import { engineReportsCost } from '../../shared/engine-switch.mjs';
import { teamCapsForTarget } from '../policy/gate.mjs';
import { teamRunDiscover } from '../git-free/team-repo.mjs';

/** `--max-budget-usd` never goes below a cent (session-host.mjs `BUDGET_FLOOR_USD`). */
const BUDGET_FLOOR_USD = 0.01;

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v.trim() ? v : null);

/** Each count of `next` at its peak against `prev`: a message's `start`, `delta` and `message` usage repeat the same
 *  counts, so they are never summed. One nested level (`cache_creation`'s ephemeral buckets) peaks the same way. */
function peakUsage(prev, next, deep = true) {
  const out = { ...prev };
  for (const [k, v] of Object.entries(next)) {
    if (Number.isFinite(v)) out[k] = Number.isFinite(out[k]) ? Math.max(out[k], v) : v;
    else if (deep && isObj(v)) out[k] = peakUsage(isObj(out[k]) ? out[k] : {}, v, false);
  }
  return out;
}

/**
 * The meter of one agent session (one row: a lead's plan and integrate, a builder's resumes, share it, L2.1).
 * - `usage` events of the main thread price each open message at its peak counts (an estimate, shown as ≥$x);
 * - a `result` with `cumulativeCost` books the difference against the session's running total, then the cost override;
 * - `settleCut()` books a process killed before its `result` at its priced usage, which the next running total nets out
 *   (the CLI restores a killed turn's spend on `--resume`: session-host.mjs `HOST_CUT_COST_RESTORED`, L2.3).
 * Unknown cost is blank, never $0: `costKnown` turns false and stays false. `priorUsd` seeds what the agent already
 * booked; `sessionUsd` (default `priorUsd`) the CLI's running total of the session the next `--resume` continues, which
 * is less once a lost session was replaced by a fresh one (a rehydrate reads it from the agent row, M3).
 * @returns {{observe(evt:object): number|null|undefined, settleCut(): number|null,
 *   snapshot(): {costUsd:number|null, estimatedUsd:number|null, costKnown:boolean, tokens:{in:number,out:number,cr:number,cw:number}},
 *   sessionTotalUsd(): number}}
 */
export function createAgentMeter({ model = null, engine = 'claude', priorUsd = 0, sessionUsd = priorUsd, costCfg = modelCostConfig(model), ratesFor } = {}) {
  const configured = str(model);
  const prior = Number.isFinite(priorUsd) && priorUsd > 0 ? priorUsd : 0;
  const reportsCost = engineReportsCost(engine);
  // The live reader re-reads Settings on every call, and the meter prices every usage event: one read per model.
  const memo = new Map();
  const rates = ratesFor || ((id) => {
    if (!memo.has(id)) memo.set(id, liveCostRates(id));
    return memo.get(id);
  });
  let sessionModel = null;
  let cliBaseline = Number.isFinite(sessionUsd) && sessionUsd > 0 ? sessionUsd : 0;
  let cutUsd = 0;
  let bookedUsd = prior;
  let booked = prior > 0;
  let costKnown = reportsCost;
  let anon = 0;
  const open = new Map();
  const totals = { in: 0, out: 0, cr: 0, cw: 0 };

  const priceModel = () => configured ?? sessionModel;
  const keyOf = (evt) => {
    if (evt.messageId != null) return `m:${evt.messageId}`;
    if (evt.phase === 'start') anon += 1;
    return `a:${anon}`;
  };
  /** The open messages' price: NaN when any of them cannot be priced. */
  const openUsd = () => {
    let sum = 0;
    for (const usage of open.values()) sum += priceUsage(priceModel(), usage, { ratesFor: rates });
    return sum;
  };
  /** Moves the open messages' tokens to the totals and clears them. */
  const retire = () => {
    for (const usage of open.values()) {
      const t = usageTokens(usage);
      for (const k of Object.keys(totals)) totals[k] += t[k];
    }
    open.clear();
  };
  const book = (usd) => { bookedUsd += usd; booked = true; return usd; };
  const unknown = () => { costKnown = false; return null; };

  function onResult(evt) {
    retire();
    if (!reportsCost) return unknown();
    const cli = evt.costUsd != null ? Number(evt.costUsd) : NaN;
    let raw = cli;
    if (evt.cumulativeCost === true && Number.isFinite(cli)) {
      raw = Math.max(0, cli - (cliBaseline + cutUsd));
      cliBaseline = cli;
      cutUsd = 0;
    }
    const usd = costCfg ? resolveModelCost(priceModel(), raw, evt.usage, costCfg) : raw;
    return Number.isFinite(usd) ? book(usd) : unknown();
  }

  return {
    observe(evt) {
      if (!isObj(evt)) return undefined;
      if (evt.type === 'session') {
        if (evt.init === true && str(evt.model)) sessionModel = evt.model;
        return undefined;
      }
      if (evt.type === 'usage') {
        if (evt.parentId != null || !isObj(evt.usage)) return undefined;
        const key = keyOf(evt);
        open.set(key, peakUsage(open.get(key) || {}, evt.usage));
        return undefined;
      }
      if (evt.type === 'result') return onResult(evt);
      return undefined;
    },
    settleCut() {
      if (!open.size) return null;
      const priced = openUsd();
      retire();
      if (!reportsCost || !Number.isFinite(priced)) return unknown();
      cutUsd += priced;
      return book(priced);
    },
    snapshot() {
      const est = open.size ? openUsd() : 0;
      const tokens = { ...totals };
      for (const usage of open.values()) {
        const t = usageTokens(usage);
        for (const k of Object.keys(tokens)) tokens[k] += t[k];
      }
      return { costUsd: booked ? bookedUsd : null, estimatedUsd: Number.isFinite(est) ? est : null, costKnown, tokens };
    },
    sessionTotalUsd() { return cliBaseline + cutUsd; },
  };
}

/** `--max-budget-usd` for one process: the per-run cap's remainder plus the session's running total, because the flag
 *  counts the whole session on a resume (session-host.mjs `HOST_BUDGET_IS_CUMULATIVE`, L2.2), floored at a cent. `null`
 *  (no flag) when worca has no per-run cap (`remainingUsd: null`, M13) or the model is booked off list price. */
export function processBudgetUsd({ remainingUsd = null, sessionTotalUsd = 0, listPriced = true } = {}) {
  if (!listPriced || !Number.isFinite(remainingUsd)) return null;
  const session = HOST_BUDGET_IS_CUMULATIVE && Number.isFinite(sessionTotalUsd) ? sessionTotalUsd : 0;
  return Math.max(BUDGET_FLOOR_USD, remainingUsd + session);
}

/** Does the CLI's own list-price meter match what worca books for `model`? Not under the credential broker (every model
 *  is routed), nor for a model with a cost override or base-URL routing (run-harness.mjs `_remainingPipelineBudgetUsd`).
 *  A model-less spawn runs the CLI default at list price. */
export function isListPriced(model) {
  if (typeof process.env.WORCA_BROKER_URL === 'string' && process.env.WORCA_BROKER_URL.trim()) return false;
  return !(model && (modelCostConfig(model) || modelHasBaseUrlRouting(model)));
}

/** worca's caps for a build of `projectDir` (null: no project): the per-run cap and the total limit, each folded with
 *  the team policy (policy/gate.mjs `teamCapsForTarget`, which never throws and falls back to the local caps), and the
 *  total limit's reset period. A design is no Git run, so a team discovery runs only over HTTPS. A team-bound soft
 *  per-run cap whose `onBreach` is `warn` is no per-run cap, as for a run (M2): run-harness.mjs `_pipelineCaps` keeps
 *  no own cap once the team binds, and `_remainingPipelineBudgetUsd` and `_checkCostLimits` skip a team cap that
 *  `_teamCapContinues` lets through, so it neither pauses the round nor meters a process. Design has no Away mode, so
 *  only `warn` continues; a missing `onBreach` is `pause`. `teamCaps` is the fold (a test seam).
 *  @param {{ projectDir?: string|null }} [target]
 *  @param {{ teamCaps?: typeof teamCapsForTarget }} [opts] */
export async function readDesignCaps({ projectDir = null } = {}, { teamCaps = teamCapsForTarget } = {}) {
  const caps = await teamCaps({ projectDir }, { discover: projectDir ? teamRunDiscover(null, projectDir) : false });
  const pipe = caps.pipeline;
  // `binding: 'team'` is a soft team cap only (policy/effective.mjs `effectiveCap`; `fieldsForRun` reads hard as soft).
  const warnsOnly = pipe.binding === 'team' && (pipe.team?.onBreach || 'pause') === 'warn';
  return { perRunCapUsd: warnsOnly ? null : pipe.cap, totalCapUsd: caps.total.cap, period: caps.period };
}
