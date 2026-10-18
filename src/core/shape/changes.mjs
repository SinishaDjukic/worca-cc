// src/core/shape/changes.mjs — Shaper s5: Ask for changes (D5), the Route card (D6) and thread replies (D8–D10).
// The card logic is pure over injected deps (startRun(body, extra) → startRunAs, addNote → addFeatureNote,
// appendRun → appendFeatureRun, answer → answerRun, tick → schedulerTick), so the rules are tested without Express.
import { landingFor } from '../../shared/shape/landing.mjs';
import { routeGuess, routeLabel, isQuestion } from '../../shared/shape/route.mjs';
import { getDb } from '../db.mjs';
import { readStoreMeta } from '../artifacts.mjs';
import { roundsOf, roundOrigin } from './rounds.mjs';
import { featureOfPipeline, currentFeatureId, featureBase } from './features.mjs';

const MAX = 4000;
const clip = (t) => String(t || '').trim().slice(0, MAX);
const firstLine = (t) => clip(t).split('\n')[0].slice(0, 80);
const startError = (r) => ({ ok: false, status: r.status, error: (r.body && r.body.error) || 'could not start' });
const NO_NEXT = 'no run is left to plan: add it as an extra run';
/** A plan note for the next run. The card's "next run" can be stale (it started since): no run left → 409, nothing stored. */
const planNote = (featureId, text, deps) => {
  const n = deps.addNote(featureId, { kind: 'plan', text });
  return n && n.runIndex != null ? { ok: true, result: { note: 'plan', index: n.runIndex } } : { ok: false, status: 409, error: NO_NEXT };
};

/** The `changes` card (state 'proposed'). `run` is the start body for a round or a plain follow-up (D3, D18). */
export function changesCard({ text, facts }) {
  const landing = landingFor(facts);
  if (!landing) return null;
  const req = clip(text);
  const r = facts.run || null;
  const f = facts.feature || null;
  const projectDir = (f && f.projectDir) || (r && r.projectDir) || null;
  const tags = (f && f.tags) || (r && r.tags) || [];          // D19: the origin's tags, so enforced tag rules pass
  const withTags = (b) => (tags.length ? { ...b, tags } : b);
  const run = landing.kind === 'round'
    ? withTags({ prompt: req, projectDir, sourceBranch: landing.target.sourceBranch, sameAsSource: true, syncBeforeStart: false })
    : landing.kind === 'follow-up' && !landing.target.featureId
      ? withTags({ prompt: req, projectDir, ...(landing.target.sourceBranch ? { sourceBranch: landing.target.sourceBranch } : {}) })
      : null;
  return { type: 'changes', text: req, landing, ...(run ? { run } : {}),
    featureId: (f && f.id) || null, pipelineId: (r && r.pipelineId) || null };
}

/** Start on a changes card. @returns {Promise<{ok: true, result: object}|{ok: false, status: number, error: string}>} */
export async function applyChanges(card, deps) {
  const { kind, target } = card.landing;
  if (kind === 'round') {
    // The number is taken now, not when the card was posted: a Watch PR fix round may have run in between (D20).
    const round = deps.nextRound ? deps.nextRound(target.roundOf) : target.round;
    const _roundOf = { pipelineId: target.roundOf, round, request: firstLine(card.text) };
    const r = await deps.startRun(card.run, { _roundOf });
    return r.status < 300 ? { ok: true, result: { runId: r.body.runId, round, pr: (target.pr && target.pr.number) || null } } : startError(r);
  }
  if (kind === 'next-plan') return planNote(target.featureId, card.text, deps);
  if (kind === 'extra-run' || (kind === 'follow-up' && target.featureId)) {
    const a = deps.appendRun(target.featureId, { title: firstLine(card.text), goal: card.text, kind: kind === 'extra-run' ? 'extra' : 'follow-up' });
    deps.tick();
    return { ok: true, result: { index: a.index, ticketId: a.ticketId } };
  }
  const r = await deps.startRun(card.run, {});                       // a plain run's follow-up from its base
  return r.status < 300 ? { ok: true, result: { runId: r.body.runId } } : startError(r);
}

/** The `route` card (state 'proposed'). */
export function routeCard({ text, feature }) {
  const guess = routeGuess(text, feature);
  const hasNext = (feature.slices || []).some((s) => s.state === 'planned' || s.state === 'missed');
  return { type: 'route', text: clip(text), featureId: feature.id, featureTitle: feature.title, base: feature.base || null,
    projectDir: feature.projectDir || null, tags: feature.tags || [], guess, hasNext, primary: routeLabel(guess.choice, feature.title) };
}

export async function applyRoute(card, v, deps) {
  if (v.verb === 'add' && v.where === 'next') {
    if (!card.hasNext) return { ok: false, status: 409, error: NO_NEXT };
    return planNote(card.featureId, card.text, deps);
  }
  if (v.verb === 'add') { const a = deps.appendRun(card.featureId, { title: firstLine(card.text), goal: card.text, kind: 'extra' }); deps.tick(); return { ok: true, result: { index: a.index } }; }
  if (v.verb === 'save') return { ok: true, result: { note: 'idea', index: deps.addNote(card.featureId, { kind: 'idea', text: card.text }).runIndex } };
  // own: from the base at once, runs alongside, its own PR (no shape, no marker)
  const r = await deps.startRun({ prompt: card.text, projectDir: card.projectDir, ...(card.base ? { sourceBranch: card.base } : {}),
    ...(card.tags && card.tags.length ? { tags: card.tags } : {}) }, {});
  return r.status < 300 ? { ok: true, result: { runId: r.body.runId } } : startError(r);
}

const answerable = (pq) => !!pq && pq.kind === 'plan' && !!pq.plan && pq.plan.revisable === true;   // Plan and Split asks

/** D8–D10: what a thread reply does. `open` = {runId, pq} of the thread's open step (pq = the live pendingQuestion). */
export function replyAction({ text, open, feature, run }, deps) {
  if (isQuestion(text)) return { action: 'chat' };
  if (open && answerable(open.pq)) {
    deps.answer(open.runId, open.pq.id, { decision: 'revise', feedback: clip(text) });
    return { action: 'answered', stepId: open.pq.id };
  }
  if (open) return { action: 'chat' };
  if (feature) {
    const toGo = (feature.slices || []).some((s) => s.state !== 'done' && s.state !== 'canceled');
    if (feature.status === 'active' && toGo) return { action: 'route' };
    return feature.status === 'done' || !toGo ? { action: 'changes' } : { action: 'chat' };
  }
  if (run && run.finished) return { action: 'changes' };
  return { action: 'chat' };
}

// ---- the facts landingFor reads, from the DB. `deps` = the server's readers: { readPrState, findPipelineRowById,
// readRunTags, featureView } (featureView carries the server's live runs map).
const FINISHED = new Set(['done', 'stopped', 'error']);
const LIVE_ROUND = new Set(['running', 'starting', 'paused']);
const parse = (t) => { try { return t ? JSON.parse(t) : null; } catch { return null; } };
const tagsOf = (deps, pid) => { try { return (pid && deps.readRunTags(pid)) || []; } catch { return []; } };

/** The landing facts of a run: a feature's when it belongs to one, else the plain run's (round 1's, for a round). */
export function landingFacts(pipelineId, deps) {
  if (!pipelineId) return null;
  const origin = roundOrigin(pipelineId);
  const at = featureOfPipeline(origin);
  if (at && at.featureId) return landingFactsOfFeature(at.featureId, deps);
  const row = deps.findPipelineRowById(origin);
  if (!row || row.target === 'workspace') return null;
  const rounds = roundsOf([row.id]).get(row.id) || [];
  return { feature: null, run: { pipelineId: row.id, title: row.title || 'this run', projectDir: readStoreMeta(row.project_key)?.path ?? null,
    finished: FINISHED.has(row.status) && !rounds.some((r) => LIVE_ROUND.has(r.status)),
    branch: parse(row.branch), pr: deps.readPrState(row.id), rounds: 1 + rounds.length, tags: tagsOf(deps, row.id) } };
}

/** The landing facts of a feature (its current successor after a re-plan). */
export function landingFactsOfFeature(featureId, deps) {
  const fid = currentFeatureId(featureId);
  const v = deps.featureView(fid);
  if (!v) return null;
  const db = getDb();
  const row = db.prepare('SELECT project_dir, origin_pipeline_id FROM shape_features WHERE id = ?').get(fid);
  const branchOf = (pid) => (pid ? parse(db.prepare('SELECT branch FROM pipelines WHERE id = ?').get(pid)?.branch) : null);
  const slices = v.slices.map((s) => ({ index: s.index, state: s.state, pipelineId: s.pipelineId, title: s.title, goal: s.goal || '',
    branch: branchOf(s.pipelineId), pr: s.pr, rounds: 1 + (s.rounds || []).length }));
  // Before Ship there is no ship PR (a round then lands "before Ship"); after it, the PR Ship opened or updated.
  const shipUrl = v.ship && v.ship.mode ? (v.ship.prUrl || v.ship.lastPrUrl) : null;
  const owner = shipUrl ? db.prepare('SELECT id FROM pipelines WHERE pr_url = ? LIMIT 1').get(shipUrl) : null;
  const shipPr = !shipUrl ? null : (owner && deps.readPrState(owner.id)) || (slices.length ? slices[slices.length - 1].pr : null);
  return { run: null, feature: { id: fid, title: v.title, status: v.status, base: featureBase(fid), projectDir: (row && row.project_dir) || null,
    shipPr, tags: tagsOf(deps, row && row.origin_pipeline_id), slices } };
}
