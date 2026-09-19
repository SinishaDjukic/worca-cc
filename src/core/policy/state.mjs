// src/core/policy/state.mjs
// Per-run team-policy state (pipelines.policy_state, v32) and the per-window total-cap
// acknowledgements (project_config.extra.teamPolicy.acks). The run state is what the
// History meta line, the resume gate and the metrics record read:
//   { home, sha, overrides: ['pipeline'|'total'], exceeded: ['pipeline'|'total'],
//     deviations: ['model:…', …], unattended: bool, reason: string|null, at }
// Reads never throw; a corrupt blob reads as {}.

import { prepare } from '../db.mjs';
import { readTeamPolicyPrefs, writeTeamPolicyPrefs } from '../config.mjs';
import { TEXT_MAX } from './registry.mjs';

const uniq = (arr) => [...new Set((Array.isArray(arr) ? arr : []).filter((x) => typeof x === 'string' && x))];

export function cleanReason(v) {
  if (v == null) return null;
  const s = String(v).replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  if (!s) return null;
  const chars = Array.from(s);
  return chars.length > TEXT_MAX ? chars.slice(0, TEXT_MAX).join('') : s;
}

/** @returns {object} the run's policy state, {} when none */
export function readPolicyState(pipelineId) {
  if (!pipelineId) return {};
  try {
    const row = prepare('SELECT policy_state FROM pipelines WHERE id = ?').get(pipelineId);
    if (!row || !row.policy_state) return {};
    const v = JSON.parse(row.policy_state);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

/**
 * Merge `patch` into the run's policy state. List fields (overrides / exceeded / deviations)
 * are UNIONED, never replaced, so the gate can add 'pipeline' after the resume set 'total'.
 * @returns {object} the merged state
 */
export function writePolicyState(pipelineId, patch = {}) {
  if (!pipelineId) return {};
  const cur = readPolicyState(pipelineId);
  const next = { ...cur, ...patch };
  for (const k of ['overrides', 'exceeded', 'deviations']) {
    if (patch[k] !== undefined || cur[k] !== undefined) next[k] = uniq([...(cur[k] || []), ...(patch[k] || [])]);
  }
  if (patch.reason !== undefined) next.reason = cleanReason(patch.reason);
  next.at = new Date().toISOString();
  prepare('UPDATE pipelines SET policy_state = ? WHERE id = ?').run(JSON.stringify(next), pipelineId);
  return next;
}

/** True when the developer chose to continue past the team's per-pipeline cap on this run. */
export function hasPipelineOverride(pipelineId) {
  return (readPolicyState(pipelineId).overrides || []).includes('pipeline');
}

// ---- total-cap acknowledgements (design §7: once per window per home) -----------------
const ackKey = (home, windowStartMs) => `${String(home).toLowerCase()}|${windowStartMs}`;

/** @returns {{at:string, reason:string|null}|null} */
export function readTotalAck(projectKey, home, windowStartMs) {
  const prefs = readTeamPolicyPrefs(projectKey);
  const acks = prefs?.acks && typeof prefs.acks === 'object' ? prefs.acks : {};
  const v = acks[ackKey(home, windowStartMs)];
  return v && typeof v === 'object' ? v : null;
}

/** Record the acknowledgement; older windows are swept so the blob never grows. */
export function setTotalAck(projectKey, home, windowStartMs, { reason = null } = {}) {
  const prefs = readTeamPolicyPrefs(projectKey);
  const acks = {};
  for (const [k, v] of Object.entries(prefs?.acks && typeof prefs.acks === 'object' ? prefs.acks : {})) {
    const ms = Number(k.split('|')[1]);
    if (Number.isFinite(ms) && ms >= windowStartMs) acks[k] = v;
  }
  acks[ackKey(home, windowStartMs)] = { at: new Date().toISOString(), reason: cleanReason(reason) };
  writeTeamPolicyPrefs(projectKey, { acks });
  return acks[ackKey(home, windowStartMs)];
}
