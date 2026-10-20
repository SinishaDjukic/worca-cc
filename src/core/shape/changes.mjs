// src/core/shape/changes.mjs — Shaper s5: Ask for changes (D5), the Route card (D6) and the two Ask Worca tools' thread rule.
// The card logic is pure over injected deps (startRun(body, extra) → startRunAs, addNote → addFeatureNote,
// appendRun → appendFeatureRun, answer → answerRun, tick → schedulerTick), so the rules are tested without Express.
import { landingFor } from '../../shared/shape/landing.mjs';
import { routeLabel, ROUTE_CHOICES } from '../../shared/shape/route.mjs';
import { getDb } from '../db.mjs';
import { readStoreMeta } from '../artifacts.mjs';
import { roundsOf, roundOrigin } from './rounds.mjs';
import { featureOfPipeline, currentFeatureId, featureBase, featureView } from './features.mjs';

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
  const labels = (f && f.labels) || (r && r.labels) || [];    // s2: and its labels
  const withTags = (b) => ({ ...b, ...(tags.length ? { tags } : {}), ...(labels.length ? { labels } : {}) });
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

const oneLine = (t, n) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n);
const NOT_STARTED = new Set(['planned', 'missed']);

/** The `route` card (state 'proposed'). `guess` = Ask Worca's { choice, reason } (route_message), checked by the caller. */
export function routeCard({ text, feature, guess }) {
  const hasNext = (feature.slices || []).some((s) => NOT_STARTED.has(s.state));
  const choice = ROUTE_CHOICES.includes(guess && guess.choice) ? guess.choice : 'save';
  const g = { choice, where: choice === 'add' ? (hasNext ? 'next' : 'extra') : null, reason: oneLine(guess && guess.reason, 200) };
  return { type: 'route', text: clip(text), featureId: feature.id, featureTitle: feature.title, base: feature.base || null,
    projectDir: feature.projectDir || null, tags: feature.tags || [], labels: feature.labels || [], guess: g, hasNext, primary: routeLabel(g.choice, feature.title) };
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
    ...(card.tags && card.tags.length ? { tags: card.tags } : {}), ...(card.labels && card.labels.length ? { labels: card.labels } : {}) }, {});
  return r.status < 300 ? { ok: true, result: { runId: r.body.runId } } : startError(r);
}

// ---- the facts landingFor reads, from the DB. `deps` = the server's readers: { readPrState, findPipelineRowById,
// readRunTags, readRunLabels, featureView } (featureView carries the server's live runs map).
const FINISHED = new Set(['done', 'stopped', 'error']);
const LIVE_ROUND = new Set(['running', 'starting', 'paused']);
const parse = (t) => { try { return t ? JSON.parse(t) : null; } catch { return null; } };
const tagsOf = (deps, pid) => { try { return (pid && deps.readRunTags(pid)) || []; } catch { return []; } };
const labelsOf = (deps, pid) => { try { return (pid && deps.readRunLabels && deps.readRunLabels(pid)) || []; } catch { return []; } };

/** The landing facts of a run: a feature's when it belongs to one, else the plain run's (round 1's, for a round). */
export function landingFacts(pipelineId, deps) {
  if (!pipelineId) return null;
  const origin = roundOrigin(pipelineId);
  const at = featureOfPipeline(origin);
  if (at && at.featureId) return landingFactsOfFeature(at.featureId, deps);
  const row = deps.findPipelineRowById(origin);
  if (!row || row.target === 'workspace') return null;
  const rounds = roundsOf([row.id]).get(row.id) || [];
  return { feature: null, run: { pipelineId: row.id, title: row.title || 'this run', status: row.status, projectDir: readStoreMeta(row.project_key)?.path ?? null,
    finished: FINISHED.has(row.status) && !rounds.some((r) => LIVE_ROUND.has(r.status)),
    branch: parse(row.branch), pr: deps.readPrState(row.id), rounds: 1 + rounds.length, tags: tagsOf(deps, row.id), labels: labelsOf(deps, row.id) } };
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
    shipPr, tags: tagsOf(deps, row && row.origin_pipeline_id), labels: labelsOf(deps, row && row.origin_pipeline_id), slices } };
}

// ---- the two Ask Worca tools (propose_changes, route_message): which work a thread follows, and the rule ----
const HALTS = new Set(['stopped', 'error', 'failed', 'paused']);
const STEP = { plan: 'Plan', outline: 'Split', questions: 'Clarify', gate: 'Gate' };

/** What a thread follows. `links` = ask_run_links rows, newest first. The first feature found wins, else the newest run.
 *  deps = { live?, readPrState, findPipelineRowById, readRunTags, readRunLabels }; `live` is the server's runs overlay (liveSliceOf),
 *  absent in the MCP child, so `open` is always null there (D7). → null when the thread follows nothing. */
export function threadWork(links, deps) {
  const live = deps.live || (() => null);
  const fv = (fid) => featureView(fid, { live });
  const factDeps = { readPrState: deps.readPrState, findPipelineRowById: deps.findPipelineRowById, readRunTags: deps.readRunTags,
    readRunLabels: deps.readRunLabels, featureView: fv };
  for (const l of links) {
    const at = l.pipelineId ? featureOfPipeline(roundOrigin(l.pipelineId)) : null;
    if (!at || !at.featureId) continue;
    const fid = currentFeatureId(at.featureId);
    const feature = fv(fid);
    if (!feature) continue;
    const ask = feature.ask;
    return { feature, run: null, facts: landingFactsOfFeature(fid, factDeps), open: ask ? { index: ask.index, kind: ask.kind } : null };
  }
  const l = links[0];
  if (!l) return null;
  const facts = l.pipelineId ? landingFacts(l.pipelineId, factDeps) : null;
  return { feature: null, run: (facts && facts.run) || null, facts, open: null };
}

/** The links of one run's work: the same round origin, or a run of the same feature (its current successor). */
export function linksOfWork(links, pipelineId) {
  const featureOf = (pid) => { const at = featureOfPipeline(pid); return at && at.featureId ? currentFeatureId(at.featureId) : null; };
  const origin = roundOrigin(pipelineId);
  const fid = featureOf(origin);
  return links.filter((l) => {
    if (!l.pipelineId) return false;
    const o = roundOrigin(l.pipelineId);
    return o === origin || (fid != null && featureOf(o) === fid);
  });
}

/** D5: the thread rule both tools obey (what the removed thread reply decided), plus the ids and the card.
 *  kind 'changes': input { pipelineId, request }; kind 'route': input { featureId, text, guess, reason }.
 *  → { ok: true, card } | { ok: false, error } — the error is what the model reads. Pure over `work`. */
export function shapeToolFit(kind, input, work) {
  const no = (error) => ({ ok: false, error });
  const raw = String((kind === 'changes' ? input.request : input.text) || '').trim();
  const field = kind === 'changes' ? 'request' : 'text';
  if (!raw) return no(`${field} is required`);
  if (raw.length > MAX) return no(`${field} must be at most ${MAX} characters`);
  if (!work) return no('this chat follows no run or feature');
  const f = work.feature;
  if (kind === 'route') {
    if (!f) return no('route_message is for a chat that follows a feature: use propose_changes for a run');
    if (currentFeatureId(String(input.featureId || '')) !== f.id) return no(`this chat follows feature ${f.id}`);
    if (!ROUTE_CHOICES.includes(input.guess)) return no('guess must be add, own or save');
    if (!oneLine(input.reason, 200)) return no('reason is required');
  }
  if (work.open) {
    const who = work.open.index != null ? `Run ${work.open.index}` : 'The re-plan';    // featureView's re-plan ask has index null
    return no(`${who} is waiting at its ${STEP[work.open.kind] || 'open'} step: the user answers it on its step card, not in the chat`);
  }
  if (f) {
    const toGo = (f.slices || []).some((s) => s.state !== 'done' && s.state !== 'canceled');
    const routeFits = f.status === 'active' && toGo;
    if (kind === 'route') {
      if (!routeFits) return no(`${f.title} has no runs to go: use propose_changes`);
      const ff = work.facts.feature;
      return { ok: true, card: routeCard({ text: raw, feature: { ...f, base: ff.base, projectDir: ff.projectDir, tags: ff.tags, labels: ff.labels },
        guess: { choice: input.guess, reason: input.reason } }) };
    }
    if (routeFits) return no(`${f.title} still has runs to go: use route_message`);
    if (f.status !== 'done' && toGo) return no(`${f.title} is ${f.status}`);
    const halted = work.facts.feature.slices.find((s) => HALTS.has(s.state));
    if (halted) return no(`Run ${halted.index} stopped: resume or re-plan it first`);
  } else if (!work.run) return no('this run has no single branch to change');
  else if (work.run.finished === false) return no('the run is still going');
  const card = changesCard({ text: raw, facts: work.facts });
  return card ? { ok: true, card } : no('this run has no single branch to change');
}

/** D5: from the thread's links to the verdict (the child calls it without `live`, the parent with it). */
export function shapeToolCheck(kind, input, links, deps) {
  if (kind !== 'changes' && kind !== 'route') return { ok: false, error: 'unknown tool' };
  if (kind === 'route') return shapeToolFit(kind, input, threadWork(links, deps));
  const pid = String(input.pipelineId || '');
  const mine = pid ? linksOfWork(links, pid) : [];
  if (!mine.length) return { ok: false, error: `this chat does not follow run ${pid || '(none)'}` };
  return shapeToolFit(kind, input, threadWork(mine, deps));
}

/** D9: the read-only facts Ask Worca gets in the turn context, or null. */
export function shapeThreadFacts(work) {
  if (!work) return null;
  const prOf = (pr) => (pr && pr.url ? { number: pr.number ?? null, state: String(pr.state || 'open').toLowerCase() } : null);
  const f = work.feature;
  if (f) {
    const next = (f.slices || []).find((s) => NOT_STARTED.has(s.state));
    return { feature: { id: f.id, title: f.title, status: f.status,
      runs: (f.slices || []).map((s) => ({ index: s.index, state: s.state, pr: prOf(s.pr) })),
      next: next ? next.index : null, shipPr: prOf(work.facts && work.facts.feature && work.facts.feature.shipPr),
      open: work.open ? { index: work.open.index ?? null, step: STEP[work.open.kind] || work.open.kind } : null } };
  }
  const r = work.run;
  return r ? { run: { id: r.pipelineId, title: r.title, status: r.status || '', finished: r.finished !== false, pr: prOf(r.pr), rounds: r.rounds || 1 } } : null;
}
