// src/core/spec-builder/history.mjs — the estimate over this machine's real history (server + Ask turn).
import { estimateSpec } from './estimate.mjs';
import { stepCostHistory } from '../stats.mjs';

export const ESTIMATE_HISTORY_DAYS = 90;
export function estimateFromHistory(fm) {
  return estimateSpec(fm, { history: stepCostHistory({ sinceDays: ESTIMATE_HISTORY_DAYS }) });
}
