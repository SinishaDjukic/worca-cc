// src/core/shape/changes.mjs — Shaper s5: Ask for changes (D5), the Route card (D6) and the two Ask Worca tools' thread rule.
// The card logic is pure over injected deps (startRun(body, extra) → startRunAs, addNote → addFeatureNote,
// appendRun → appendFeatureRun, answer → answerRun, tick → schedulerTick), so the rules are tested without Express.
import { landingFor } from '../../shared/shape/landing.mjs';
import { routeLabel, ROUTE_CHOICES } from '../../shared/shape/route.mjs';
import { getDb } from '../db.mjs';
import { readStoreMeta, projectDirOfRow } from '../artifacts.mjs';
import { roundsOf, roundOrigin } from './rounds.mjs';
import { featureOfPipeline, currentFeatureId, featureBase, featureView, changeAgreedRequirements, featureHoldsTicket } from './features.mjs';
import { changesRequirementsBlock } from '../../shared/shape/acceptance.mjs';
import { getTicket, requestRunNow } from '../scheduler.mjs';
import { smallRunsOfFeature } from './small-runs.mjs';
import { entryFeatureOf } from './held-stops.mjs';
import { changeCaseOf, normalizeChange, CHANGE_TEXT_MAX } from '../../shared/shape/req-change.mjs';

const MAX = 4000;
const clip = (t) => String(t || '').trim().slice(0, MAX);
const firstLine = (t) => clip(t).split('\n')[0].slice(0, 80);
const startError = (r) => ({ ok: false, status: r.status, error: (r.body && r.body.error) || 'could not start', ...(r.body && r.body.code === 'SHIPPING' ? { code: 'SHIPPING' } : {}) });
const NO_NEXT = 'no run is left to plan: add it as an extra run';
/** A plan note for the next run. The card's "next run" can be stale (it started since): no run left → 409, nothing stored. */
const planNote = (featureId, text, deps) => {
  const n = deps.addNote(featureId, { kind: 'plan', text });
  return n && n.runIndex != null ? { ok: true, result: { note: 'plan', index: n.runIndex } } : { ok: false, status: 409, error: NO_NEXT };
};

/** The `changes` card (state 'proposed'). `run` is the start body for a round or a plain follow-up (D3, D18).
 *  Shaper requirements s3 (D12): a shipped feature with agreed requirements updates them first:
 *  the card says so (`requirementsFirst`), a round runs shaped and its prompt lists the agreed requirements. */
export function changesCard({ text, facts }) {
  const landing = landingFor(facts);
  if (!landing) return null;
  const req = clip(text);
  const r = facts.run || null;
  const f = facts.feature || null;
  const projectDir = (f && f.projectDir) || (r && r.projectDir) || null;
  const tags = (f && f.tags) || (r && r.tags) || [];          // D19: the origin's tags, so enforced tag rules pass
  const labels = (f && f.labels) || (r && r.labels) || [];    // s2: and its labels
  // The set of the run it changes (a feature round: that run's, else the feature's), never the install default. A run
  // with none stored sends none; the start then guards a card start against a Permissive default (ui/server.mjs).
  const roundRun = landing.kind === 'round' && f ? (f.slices || []).find((s) => s.pipelineId === landing.target.roundOf) : null;
  const guardrailsId = (roundRun && roundRun.guardrailsId) || (f && f.guardrailsId) || (r && r.guardrailsId) || null;
  const withTags = (b) => ({ ...b, ...(guardrailsId ? { guardrailsId } : {}), ...(tags.length ? { tags } : {}), ...(labels.length ? { labels } : {}) });
  const first = !!f && f.shipped === true && Array.isArray(f.agreed) && f.agreed.length > 0
    && (landing.kind === 'round' || landing.kind === 'follow-up');
  const run = landing.kind === 'round' && first
    ? withTags({ prompt: `${req}\n\n${changesRequirementsBlock(f.agreed, f.acceptance)}`, projectDir, sourceBranch: landing.target.sourceBranch,
      sameAsSource: true, syncBeforeStart: false, shape: { perspectives: [...(f.perspectives || [])], size: 'medium', slices: 'off' } })
    : landing.kind === 'round'
    ? withTags({ prompt: req, projectDir, sourceBranch: landing.target.sourceBranch, sameAsSource: true, syncBeforeStart: false })
    : landing.kind === 'follow-up' && !landing.target.featureId
      ? withTags({ prompt: req, projectDir, ...(landing.target.sourceBranch ? { sourceBranch: landing.target.sourceBranch } : {}) })
      : null;
  return { type: 'changes', text: req, landing, ...(run ? { run } : {}),
    featureId: (f && f.id) || null, pipelineId: (r && r.pipelineId) || null,
    ...(first ? { requirementsFirst: { count: f.agreed.length, block: changesRequirementsBlock(f.agreed, f.acceptance) } } : {}) };
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
    const first = kind === 'follow-up' && card.requirementsFirst ? card.requirementsFirst : null;   // s3 (D12)
    const a = deps.appendRun(target.featureId, { title: firstLine(card.text), goal: first ? `${card.text}\n\n${first.block}` : card.text,
      kind: kind === 'extra-run' ? 'extra' : 'follow-up', ...(first ? { requirementsFirst: true } : {}) });
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
    projectDir: feature.projectDir || null, tags: feature.tags || [], labels: feature.labels || [], guardrailsId: feature.guardrailsId || null,
    guess: g, hasNext, primary: routeLabel(g.choice, feature.title) };
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
    ...(card.guardrailsId ? { guardrailsId: card.guardrailsId } : {}),
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
  return { feature: null, run: { pipelineId: row.id, title: row.title || 'this run', status: row.status, projectDir: row.is_test ? projectDirOfRow(row) : readStoreMeta(row.project_key)?.path ?? null,
    finished: FINISHED.has(row.status) && !rounds.some((r) => LIVE_ROUND.has(r.status)),
    branch: parse(row.branch), pr: deps.readPrState(row.id), rounds: 1 + rounds.length, tags: tagsOf(deps, row.id), labels: labelsOf(deps, row.id),
    guardrailsId: row.guardrails_id || null } };
}

/** The landing facts of a feature (its current successor after a re-plan). */
export function landingFactsOfFeature(featureId, deps) {
  const fid = currentFeatureId(featureId);
  const v = deps.featureView(fid);
  if (!v) return null;
  const db = getDb();
  const row = db.prepare('SELECT project_dir, origin_pipeline_id, outline, perspectives, request_base FROM shape_features WHERE id = ?').get(fid);
  const outline = parse(row && row.outline) || {};
  const pipeOf = (pid) => (pid ? db.prepare('SELECT branch, guardrails_id FROM pipelines WHERE id = ?').get(pid) : null);
  const slices = v.slices.map((s) => { const p = pipeOf(s.pipelineId); return { index: s.index, state: s.state, pipelineId: s.pipelineId, title: s.title,
    goal: s.goal || '', branch: parse(p && p.branch), guardrailsId: (p && p.guardrails_id) || null, pr: s.pr, rounds: 1 + (s.rounds || []).length }; });
  // Before Ship there is no ship PR (a round then lands "before Ship"); after it, the PR Ship opened or updated.
  const shipUrl = v.ship && v.ship.mode ? (v.ship.prUrl || v.ship.lastPrUrl) : null;
  const owner = shipUrl ? db.prepare('SELECT id FROM pipelines WHERE pr_url = ? LIMIT 1').get(shipUrl) : null;
  const shipPr = !shipUrl ? null : (owner && deps.readPrState(owner.id)) || (slices.length ? slices[slices.length - 1].pr : null);
  // s3 (D12): shipped, and the agreed requirements with their marks, for a requirements-first Changes run.
  return { run: null, feature: { id: fid, title: v.title, status: v.status, base: featureBase(fid), projectDir: (row && row.project_dir) || null,
    shipPr, tags: tagsOf(deps, row && row.origin_pipeline_id), labels: labelsOf(deps, row && row.origin_pipeline_id), slices,
    shipped: !!(v.ship && v.ship.mode), agreed: Array.isArray(outline.agreed) ? outline.agreed.map(({ id, text }) => ({ id, text })) : [],
    acceptance: Array.isArray(outline.acceptance) ? outline.acceptance : [], perspectives: parse(row && row.perspectives) || [],
    guardrailsId: (parse(row && row.request_base) || {}).guardrailsId || null } };
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
    // Slice 6 (D16): with the stop list, the open step is the first open stop; a failed run never is (feature-card.mjs ptr).
    const ask = Array.isArray(feature.asks)
      ? (feature.asks.find((a) => a && !a.failed) || (feature.ask && feature.ask.index == null ? feature.ask : null))
      : feature.ask;
    return { feature, run: null, facts: landingFactsOfFeature(fid, factDeps), open: ask ? { index: ask.index, kind: ask.kind } : null,
      ...(smallRunsOfFeature(fid) ? { smallRuns: true } : {}) };
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
 *  kind 'changes': input { pipelineId, request }; kind 'route': input { featureId, text, guess, reason };
 *  kind 'requirement' (small runs C4): input { featureId, requirement, text, reason }.
 *  → { ok: true, card } | { ok: false, error } — the error is what the model reads. Pure over `work`. */
export function shapeToolFit(kind, input, work) {
  const no = (error) => ({ ok: false, error });
  const raw = String((kind === 'changes' ? input.request : input.text) || '').trim();
  const field = kind === 'changes' ? 'request' : 'text';
  if (!raw) return no(`${field} is required`);
  if (raw.length > MAX) return no(`${field} must be at most ${MAX} characters`);
  if (!work) return no('this chat follows no run or feature');
  const f = work.feature;
  if (kind === 'requirement') {
    if (!f) return no('change_requirement is for a chat that follows a feature');
    if (currentFeatureId(String(input.featureId || '')) !== f.id) return no(`this chat follows feature ${f.id}`);
    if (!oneLine(input.reason, 200)) return no('reason is required');
  }
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
  if (kind === 'requirement') return requirementFit(raw, input, work);
  if (f) {
    const toGo = (f.slices || []).some((s) => s.state !== 'done' && s.state !== 'canceled');
    const routeFits = f.status === 'active' && toGo;
    if (kind === 'route') {
      if (!routeFits) return no(`${f.title} has no runs to go: use propose_changes`);
      const ff = work.facts.feature;
      return { ok: true, card: routeCard({ text: raw, feature: { ...f, base: ff.base, projectDir: ff.projectDir, tags: ff.tags, labels: ff.labels,
        guardrailsId: ff.guardrailsId },
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

/** Small runs C4 (D13): change_requirement on a marked, active feature → the `req-change` card (state 'proposed'),
 *  `landsAs` the case of the run that owns the requirement. */
function requirementFit(raw, input, work) {
  const no = (error) => ({ ok: false, error });
  const f = work.feature;
  if (!work.smallRuns) return no(`${f.title} is not built with small runs`);
  if (f.status !== 'active' && f.status !== 'done') return no(`${f.title} is ${f.status}`);
  const id = String(input.requirement || '').trim();
  const a = ((work.facts && work.facts.feature && work.facts.feature.agreed) || []).find((x) => x.id === id);
  if (!a) return no(`${id || '(none)'} is not an agreed requirement of ${f.title}`);
  const n = normalizeChange({ id, from: a.text, to: raw });
  if (!n.ok) return no(n.code === 'UNCHANGED' ? `${id} already reads that` : `text must be at most ${CHANGE_TEXT_MAX} characters`);
  const owner = (f.slices || []).find((s) => (s.requirements && s.requirements.ids || []).includes(id));
  return { ok: true, card: { type: 'req-change', featureId: f.id, featureTitle: f.title, requirement: id, from: a.text, to: n.change.to,
    reason: oneLine(input.reason, 200), landsAs: owner ? changeCaseOf(owner.state) : 'none' } };
}

/** Small runs C4 (D13): the chat card's primary applies its one change through the one change path. */
export function applyRequirementCard(card, deps) {
  return deps.apply(card.featureId, [{ id: card.requirement, from: card.from, to: card.to }], { kind: 'chat', by: deps.by || null });
}

/** D5: from the thread's links to the verdict (the child calls it without `live`, the parent with it). */
export function shapeToolCheck(kind, input, links, deps) {
  if (kind !== 'changes' && kind !== 'route' && kind !== 'requirement') return { ok: false, error: 'unknown tool' };
  if (kind === 'route' || kind === 'requirement') return shapeToolFit(kind, input, threadWork(links, deps));
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

// ---- Small runs C4: a requirement change mid-build (D1–D12) ----
const SETTLED_ENTRY = new Set(['done', 'stopped', 'error', 'interrupted']);
const LIVE_ASK = new Set(['approval', 'questions']);
const refusal = (status, code, error) => ({ ok: false, status, code, error });
const CODE_TEXT = {
  INVALID_ID: () => 'a requirement id looks like R-po-1',
  INVALID_TEXT: () => `the new text must be 1 to ${CHANGE_TEXT_MAX} characters`,
  UNCHANGED: (id) => `${id} already reads that`,
};

/**
 * Small runs C4 (D3–D6), shared with the Verifier's gate (slice 8, D7): plan where each validated change lands, by the
 * owner's case in `slices` (featureView's). `source` is the entries' source, `asker` the asking run's number (its own
 * requirement waits), `firstIndex` the number of the first run appended. Writes nothing.
 * → {plan:{changes, entries, restart, appendFor, by}, after:{live, paused}}
 */
export function planRequirementChange(slices, list, { source, asker = null, at, by, firstIndex = slices.length + 1 }) {
  const plan = { changes: list, entries: [], restart: [], appendFor: [], by };
  const after = { live: [], paused: [] };
  let nextIndex = firstIndex;
  const appendOf = new Map();
  for (const c of list) {
    const owner = slices.find((s) => (s.requirements && s.requirements.ids || []).includes(c.id)) || null;
    const self = !!owner && owner.index === asker;
    const kase = self ? 'waiting' : owner ? changeCaseOf(owner.state) : 'none';
    const e = { id: c.id, from: c.from, to: c.to, at, by, source,
      case: kase, run: kase === 'none' ? null : owner.index };
    if (self) e.self = true;
    else if (kase === 'running') { if (!plan.restart.includes(owner.index)) { plan.restart.push(owner.index); if (owner.pipelineId) after.live.push(owner.pipelineId); } }
    else if (kase === 'waiting' && LIVE_ASK.has(owner.state) && owner.pipelineId) { e.closedAsk = true; if (!after.live.includes(owner.pipelineId)) after.live.push(owner.pipelineId); }
    else if (kase === 'waiting' && owner.state === 'paused' && owner.pipelineId) { if (!after.paused.includes(owner.pipelineId)) after.paused.push(owner.pipelineId); }
    else if (kase === 'finished') {
      let a = appendOf.get(owner.index);
      if (!a) { a = { ownerIndex: owner.index, ids: [], index: nextIndex++ }; appendOf.set(owner.index, a); plan.appendFor.push(a); }
      a.ids.push(c.id);
      e.added = a.index;
    }
    plan.entries.push(e);
  }
  for (const a of plan.appendFor) {
    const lines = a.ids.map((id) => `${id} now reads: ${list.find((c) => c.id === id).to}`);
    Object.assign(a, { title: `Change: ${a.ids.join(', ')}`, goal: `Change the finished work so it meets the changed requirement.\n\n${lines.join('\n')}` });
  }
  return { plan, after };
}

/**
 * Small runs C4 (D1): the one path for a requirement change, from a chat card (source.kind 'chat') or a run's
 * requirement stop (source.kind 'run', with the asking run's pipelineId and number). Synchronous over `deps`
 * ({view, write, stopLive, stopPaused, runNow, tick, broadcast, smallRuns}): validate, read the cases from the live view,
 * write the text and its landing in one tx, then fire the restart tickets, stop the live owners (no await in between),
 * settle paused ones, tick and repaint. A refusal changes nothing.
 * → {ok:true, result:{changes:[{id, case, run, added?}], stopFailed?}} | {ok:false, status, code, error}
 */
export function applyRequirementChange(featureId, changes, source, deps) {
  const by = (source && source.by) || null;
  const view = deps.view(featureId);
  if (!view) return refusal(404, 'FEATURE_NOT_FOUND', 'feature not found');
  if (!deps.smallRuns(view.id)) return refusal(409, 'NOT_SMALL_RUNS', 'requirement changes need Shaper small runs');
  if (view.status !== 'active' && view.status !== 'done') return refusal(409, 'FEATURE_NOT_ACTIVE', `${view.title} is ${view.status}`);
  const agreed = new Map(((view.ship && view.ship.acceptance && view.ship.acceptance.agreed) || []).map((a) => [a.id, a.text]));
  const list = [];
  for (const raw of Array.isArray(changes) ? changes : []) {
    const n = normalizeChange(raw);
    if (!n.ok) return refusal(422, n.code, CODE_TEXT[n.code](raw && raw.id));
    if (!agreed.has(n.change.id)) return refusal(422, 'UNKNOWN_REQUIREMENT', `${n.change.id} is not an agreed requirement of ${view.title}`);
    if (agreed.get(n.change.id) !== n.change.from) return refusal(409, 'STALE', `${n.change.id} changed since: read it again`);
    list.push(n.change);
  }
  if (!list.length) return refusal(422, 'INVALID_ID', CODE_TEXT.INVALID_ID());
  const asker = source && source.kind === 'run' ? source.run : null;
  const { plan, after } = planRequirementChange(view.slices || [], list, { asker, at: new Date().toISOString(), by,
    source: { kind: source.kind, ...(Number.isInteger(asker) ? { run: asker } : {}) } });
  let written;
  try { written = deps.write(view.id, plan); }
  catch (err) {
    if (err && err.code === 'STALE') return refusal(409, 'STALE', err.message);
    if (err && err.code === 'SHIPPING') return refusal(409, 'SHIPPING', err.message);   // the Ship lock
    if (err && err.code === 'CANNOT_RESTART') return refusal(err.status || 409, 'CANNOT_RESTART', err.message);
    throw err;
  }
  for (const r of (written && written.restarted) || []) deps.runNow(r.ticketId, by);
  let stopFailed = false;
  for (const pid of after.live) {
    try { deps.stopLive(pid, by); }
    catch (err) { stopFailed = true; console.error(`[worca-ui] requirement change: could not stop run ${pid}: ${err && err.message ? err.message : err}`); }
  }
  for (const pid of after.paused) {
    try { Promise.resolve(deps.stopPaused(pid, by)).catch((err) => console.error(`[worca-ui] requirement change: paused run ${pid} not stopped: ${err && err.message ? err.message : err}`)); }
    catch (err) { console.error(`[worca-ui] requirement change: paused run ${pid} not stopped: ${err && err.message ? err.message : err}`); }
  }
  deps.tick();
  deps.broadcast(view.id);
  return { ok: true, result: { changes: plan.entries.map((e) => ({ id: e.id, case: e.case, run: e.run, ...(Number.isInteger(e.added) ? { added: e.added } : {}) })),
    ...(stopFailed ? { stopFailed: true } : {}) } };
}

/** C4's run-now rule (D6): an appended slice ticket the "Ask me before each run" hold would keep is forced, so it fires
 *  without asking. Small runs C5 starts its gap runs through it too. */
export function runNow(id, by) {
  return featureHoldsTicket(getTicket(id)) && requestRunNow(id, { by: by || undefined });
}

/**
 * The server's change path (D15): `apply` for the chat card, `applyStop` for createHeldStops' Change answer. deps =
 * { runs, stopRun(runId, by), stopPausedPipeline(pipelineId, by), schedulerTick(), broadcastFeature(id), liveSliceOf(id) }.
 */
export function createRequirementChanges({ runs, stopRun, stopPausedPipeline, schedulerTick, broadcastFeature, liveSliceOf }) {
  const entryOf = (pid) => { for (const e of runs.values()) if (e && e.pipelineId === pid) return e; return null; };
  const deps = {
    view: (fid) => featureView(currentFeatureId(String(fid || '')), { live: liveSliceOf }),
    write: (fid, plan) => changeAgreedRequirements(fid, plan),
    stopLive: (pid, by) => {
      const e = entryOf(pid);
      if (!e || SETTLED_ENTRY.has(String(e.status || ''))) return 'gone';
      Promise.resolve(stopRun(e.id, by || 'local')).catch((err) => console.error(`[worca-ui] requirement change: stop ${pid}: ${err && err.message ? err.message : err}`));
      return 'stopped';
    },
    stopPaused: (pid, by) => stopPausedPipeline(pid, by || 'local'),
    runNow,
    tick: () => { void Promise.resolve(schedulerTick()).catch(() => {}); },
    broadcast: (fid) => broadcastFeature(fid),
    smallRuns: (fid) => smallRunsOfFeature(fid),
  };
  const apply = (featureId, changes, source) => applyRequirementChange(featureId, changes, source, deps);
  /** A requirement stop's Change answer: throws the refusal (code, status), so the question stays open. → {changeRun} */
  function applyStop(entry, stop, by) {
    const at = entryFeatureOf(entry);
    if (!at) throw Object.assign(new Error('this run belongs to no feature'), { code: 'FEATURE_NOT_FOUND', status: 404 });
    const r = apply(at.featureId, stop.change, { kind: 'run', pipelineId: entry.pipelineId || null, run: at.index, by });
    if (!r.ok) throw Object.assign(new Error(r.error), { code: r.code, status: r.status });
    // D12: a non-owner asker is told which run builds the change.
    const other = r.result.changes.find((c) => c.case !== 'none' && (c.added ?? c.run) !== at.index);
    return { ...r.result, changeRun: other ? (other.added ?? other.run) : null };
  }
  return { apply, applyStop };
}
