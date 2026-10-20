// src/core/shape/rounds.mjs — Shaper s5 (D4): rounds of a run. The marker is branch.roundOf on the round's own row
// ({pipelineId: round 1's id, round: n, request}); idx_pipelines_round_of (v67) finds them. A Watch PR fix round
// (D20, D21) also carries `by: 'watch'`, its trigger `kinds` and, once the watch lets go, its `outcome`.
import { getDb, ROUND_OF_EXPR } from '../db.mjs';

const j = (t) => { try { return t ? JSON.parse(t) : null; } catch { return null; } };

/** @returns {Map<string, Array<{round: number, pipelineId: string, status: string, request: string, by?: 'watch', kinds?: string[], outcome?: object}>>} */
export function roundsOf(pipelineIds) {
  const ids = [...new Set((pipelineIds || []).filter(Boolean).map(String))];
  const out = new Map();
  if (!ids.length) return out;
  const rows = getDb().prepare(`SELECT id, status, branch FROM pipelines
    WHERE ${ROUND_OF_EXPR} IN (${ids.map(() => '?').join(', ')})`).all(...ids);
  for (const r of rows) {
    const m = j(r.branch)?.roundOf;
    if (!m || !Number.isInteger(m.round)) continue;
    const list = out.get(m.pipelineId) || [];
    list.push({ round: m.round, pipelineId: r.id, status: String(r.status || ''), request: String(m.request || ''),
      ...(m.by === 'watch' ? { by: 'watch', kinds: Array.isArray(m.kinds) ? m.kinds : [] } : {}),
      ...(m.outcome ? { outcome: m.outcome } : {}) });
    out.set(m.pipelineId, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.round - b.round);
  return out;
}

/** Round 1's pipeline id for any round (the marker always names round 1), else the id itself. */
export function roundOrigin(pipelineId) {
  const row = getDb().prepare('SELECT branch FROM pipelines WHERE id = ?').get(String(pipelineId));
  return j(row && row.branch)?.roundOf?.pipelineId || String(pipelineId);
}

/** The next round number of `origin`: one past its highest round, 2 when it has none. */
export function nextRound(origin) {
  const list = roundsOf([origin]).get(String(origin)) || [];
  return list.reduce((n, r) => Math.max(n, r.round), 1) + 1;
}

const OUTCOME_KINDS = new Set(['pushed', 'ended', 'failed']);
/** D21: the stored shape of a fix round's outcome (src/core/pr-watch.mjs fixOutcome), or null. */
export function cleanOutcome(o) {
  if (!o || typeof o !== 'object' || !OUTCOME_KINDS.has(o.kind)) return null;
  return { kind: o.kind, ...(o.sha ? { sha: String(o.sha).slice(0, 7) } : {}),
    ...(o.reason ? { reason: String(o.reason).slice(0, 60) } : {}), ...(o.stopped ? { stopped: String(o.stopped).slice(0, 60) } : {}) };
}

/** D21: write a fix round's outcome onto its marker, once. → true when written. */
export function setRoundOutcome(pipelineId, outcome) {
  const o = cleanOutcome(outcome);
  if (!pipelineId || !o) return false;
  // Every json_extract on branch goes through the json_valid guard: SQLite does not promise AND-term order.
  const safe = 'CASE WHEN json_valid(branch) THEN branch END';
  const r = getDb().prepare(`UPDATE pipelines SET branch = json_set(branch, '$.roundOf.outcome', json(?))
    WHERE id = ? AND ${ROUND_OF_EXPR} IS NOT NULL AND json_extract(${safe}, '$.roundOf.outcome') IS NULL`)
    .run(JSON.stringify(o), String(pipelineId));
  return r.changes > 0;
}
