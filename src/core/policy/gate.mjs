// src/core/policy/gate.mjs
// The team-cap gates the run ENTRY points share (POST /api/run, POST /api/resume, the CLI):
// the same fold the harness applies at every step boundary (run-harness._checkCostLimits),
// evaluated once before a run or resume is created so the caller can answer with a dialog
// instead of a pause. Soft only (team-policy design §7): a breach is never a refusal when
// the developer says `pastTeamCap`, when the cap says `onBreach: warn`, or when nobody is
// there to click (an unattended run).

import { pipelineCostLimitUsd, totalCostLimitUsd, costLimitResetPeriod, readSettings } from '../settings.mjs';
import { totalWindowSpendUsd, costWindowStart } from '../cost-budget.mjs';
import { projectKey } from '../store.mjs';
import { resolveProjectPolicy, resolveWorkspacePolicy } from './sync.mjs';
import { fieldsForRun, effectiveCap } from './effective.mjs';
import { readTotalAck, setTotalAck, hasPipelineOverride, writePolicyState, cleanReason } from './state.mjs';

/**
 * Resolve the policy for a run target and fold its two caps. Never throws; a target with no
 * policy answers { policy: null }.
 * @param {{projectDir?:string, workspaceId?:string}} target
 */
export async function teamCapsForTarget({ projectDir = null, workspaceId = null } = {}, { discover = 'if-missing' } = {}) {
  let r = null;
  try {
    r = workspaceId ? await resolveWorkspacePolicy(workspaceId, { discover }) : projectDir ? await resolveProjectPolicy(projectDir, { discover }) : null;
  } catch { r = null; }
  if (!r || !r.ok) return { policy: null, fields: {}, pipeline: effectiveCap({ local: pipelineCostLimitUsd() }), total: effectiveCap({ local: totalCostLimitUsd() }), period: costLimitResetPeriod() };
  const fields = fieldsForRun(r.doc, { workspaceRun: !!workspaceId });
  const stored = readSettings().costLimitResetPeriod;
  const teamPeriod = fields['cost.resetPeriod']?.value;
  const period = stored === 'weekly' || stored === 'monthly' ? stored : (teamPeriod === 'weekly' || teamPeriod === 'monthly' ? teamPeriod : costLimitResetPeriod());
  return {
    policy: { home: r.home, homeDir: r.homeDir, sha: r.sha, delegated: r.delegated, from: r.from },
    fields,
    pipeline: effectiveCap({ local: pipelineCostLimitUsd(), team: fields['cost.pipelineLimitUsd'] || null }),
    total: effectiveCap({ local: totalCostLimitUsd(), team: fields['cost.totalLimitUsd'] || null }),
    period,
  };
}

const usd = (n) => Number(n).toFixed(2);

/**
 * The team TOTAL cap at a run entry. `pastTeamCap` records the once-per-window acknowledgement
 * (design §7) and lets the run through; a cap with `requireReason` refuses an empty reason.
 * @returns {Promise<{blocked:false, caps:object, ack?:object} | {blocked:true, caps:object, error:string, code:'team_total'|'reason_required', policy:object}>}
 */
export async function checkTeamTotalGate(target, { pastTeamCap = false, reason = null, unattended = false, now = new Date() } = {}) {
  const caps = await teamCapsForTarget(target);
  const { total, policy, period } = caps;
  if (!policy || total.binding !== 'team' || total.cap == null) return { blocked: false, caps };
  const windowStartMs = costWindowStart(now, period).getTime();
  const spent = totalWindowSpendUsd(windowStartMs);
  if (spent < total.cap) return { blocked: false, caps };
  const team = total.team;
  const ackKey = projectKey(policy.homeDir);
  const w = period === 'weekly' ? 'week' : 'month';
  const detail = { home: policy.home, cap: total.cap, spent, period, window: w, windowStartMs, requireReason: !!team.requireReason, onBreach: team.onBreach || 'pause' };
  if (readTotalAck(ackKey, policy.home, windowStartMs)) return { blocked: false, caps, acked: true };
  if ((team.onBreach || 'pause') === 'warn' || unattended) return { blocked: false, caps, warned: true };
  if (pastTeamCap) {
    const clean = cleanReason(reason);
    if (team.requireReason && !clean) return { blocked: true, caps, code: 'reason_required', error: `the team policy on ${policy.home} requires a reason to continue past its total cap`, policy: detail };
    const ack = setTotalAck(ackKey, policy.home, windowStartMs, { reason: clean });
    return { blocked: false, caps, ack };
  }
  return { blocked: true, caps, code: 'team_total', error: `team total cap reached ($${usd(spent)} >= $${usd(total.cap)} this ${w}, ${policy.home})`, policy: detail };
}

/**
 * The team PIPELINE cap at a resume. `pastTeamCap` arms the per-pipeline override (persisted on
 * the run, design §7) and lets the resume through.
 * @returns {{blocked:false} | {blocked:true, error:string, code:'team_pipeline'|'reason_required', policy:object}}
 */
export function checkTeamPipelineGate(caps, { pipelineId, spentSoFar = 0, pastTeamCap = false, reason = null, unattended = false } = {}) {
  const { pipeline, policy } = caps;
  // The team SOFT cap is checked whether or not it is the tighter number (the local override
  // never bypasses it — run-harness._checkCostLimits applies the same rule at every boundary).
  const team = pipeline?.team && pipeline.team.kind === 'soft' ? pipeline.team : null;
  if (!policy || !team) return { blocked: false };
  if (spentSoFar < team.value) return { blocked: false };
  if (hasPipelineOverride(pipelineId)) return { blocked: false, overridden: true };
  const detail = { home: policy.home, cap: team.value, spent: spentSoFar, requireReason: !!team.requireReason, onBreach: team.onBreach || 'pause' };
  if ((team.onBreach || 'pause') === 'warn' || unattended) return { blocked: false, warned: true };
  if (pastTeamCap) {
    const clean = cleanReason(reason);
    if (team.requireReason && !clean) return { blocked: true, code: 'reason_required', error: `the team policy on ${policy.home} requires a reason to continue past its cost cap`, policy: detail };
    writePolicyState(pipelineId, { home: policy.home, sha: policy.sha, overrides: ['pipeline'], ...(clean ? { reason: clean } : {}) });
    return { blocked: false, overridden: true };
  }
  return { blocked: true, code: 'team_pipeline', error: `team cost cap reached ($${usd(spentSoFar)} >= $${usd(team.value)}, ${policy.home})`, policy: detail };
}
