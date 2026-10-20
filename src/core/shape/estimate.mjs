// src/core/shape/estimate.mjs — the nudge's two estimates (spec §3.2, S3): per-agent medians of done runs, summed
// over a workflow's agent nodes. No history, no number.
import { prepare } from '../db.mjs';

export const ESTIMATE_MIN_SAMPLES = 3;
export const ESTIMATE_HISTORY_DAYS = 60;

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Map(agentKey -> {cost:number[], ms:number[]}): one sample per (run, agent), loops summed. */
export function stepHistory({ sinceDays = ESTIMATE_HISTORY_DAYS, now = Date.now() } = {}) {
  const since = new Date(now - sinceDays * 86_400_000).toISOString();
  // agent_key, not phase: phase also holds script keys (orchestrator.mjs:1539-1541).
  const rows = prepare(`SELECT s.agent_key AS agent, SUM(s.cost_usd) AS cost, SUM(s.active_ms) AS ms
    FROM pipeline_steps s JOIN pipelines p ON p.id = s.pipeline_id
    WHERE p.status = 'done' AND p.started_at >= ? AND s.agent_key IS NOT NULL
    GROUP BY s.pipeline_id, s.agent_key`).all(since);
  const out = new Map();
  for (const r of rows) {
    const h = out.get(r.agent) || { cost: [], ms: [] };
    h.cost.push(Number(r.cost) || 0);
    h.ms.push(Number(r.ms) || 0);
    out.set(r.agent, h);
  }
  return out;
}

const agentKeys = (wf) => (Array.isArray(wf?.nodes) ? wf.nodes : []).filter((n) => n && n.kind === 'agent' && n.key).map((n) => n.key);

/** The planning agents (Clarify, Plan, the role reviewers, Refine): the nudge shows their share apart from the build (D28). */
export const PLANNING_AGENTS = Object.freeze(['clarify', 'planner', 'planReviewer', 'refiner']);
/** Role reviews (spec §4a "Cost"): too little planReviewer history borrows the refiner's — same planning weight. */
const FALLBACK = Object.freeze({ planReviewer: 'refiner' });
const PLANNING = new Set(PLANNING_AGENTS);
const cents = (x) => Math.round(x * 100) / 100;

/** @returns {null|{costUsd:number, planningUsd:number, buildUsd:number, minutes:number, samples:number}} */
export function estimateGraph(wf, history) {
  const keys = agentKeys(wf);
  if (!keys.length || !history) return null;
  let cost = 0; let planning = 0; let ms = 0; let samples = Infinity;
  for (const k of keys) {
    let h = history.get(k);
    if ((!h || h.cost.length < ESTIMATE_MIN_SAMPLES) && FALLBACK[k]) h = history.get(FALLBACK[k]);
    if (!h || h.cost.length < ESTIMATE_MIN_SAMPLES) return null;
    const c = median(h.cost);
    cost += c; if (PLANNING.has(k)) planning += c;
    ms += median(h.ms); samples = Math.min(samples, h.cost.length);
  }
  return { costUsd: cents(cost), planningUsd: cents(planning), buildUsd: cents(cost - planning),
    minutes: Math.max(1, Math.round(ms / 60_000)), samples };
}

/** Both choices' figures, each split into planning and build (D28): history has no workflow column (F9), so two graphs
 *  with the same agents give the same figure — shown on both, since each now says what it covers. */
export function estimateChoices({ asIs, shaped }, { history = stepHistory() } = {}) {
  return { asIs: estimateGraph(asIs, history), shaped: estimateGraph(shaped, history) };
}
