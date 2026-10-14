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

/** @returns {null|{costUsd:number, minutes:number, samples:number}} */
export function estimateGraph(wf, history) {
  const keys = agentKeys(wf);
  if (!keys.length || !history) return null;
  let cost = 0; let ms = 0; let samples = Infinity;
  for (const k of keys) {
    const h = history.get(k);
    if (!h || h.cost.length < ESTIMATE_MIN_SAMPLES) return null;
    cost += median(h.cost); ms += median(h.ms); samples = Math.min(samples, h.cost.length);
  }
  return { costUsd: Math.round(cost * 100) / 100, minutes: Math.max(1, Math.round(ms / 60_000)), samples };
}

/** History has no workflow column (F9), so two graphs with the same agents always sum to the same figure: `same`
 *  tells the card to show one build estimate, not two equal numbers that look like a comparison (S3). */
export function estimateChoices({ asIs, shaped }, { history = stepHistory() } = {}) {
  const a = agentKeys(asIs).sort().join(','); const s = agentKeys(shaped).sort().join(',');
  return { asIs: estimateGraph(asIs, history), shaped: estimateGraph(shaped, history), same: a !== '' && a === s };
}
