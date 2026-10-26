// src/core/shape/features.mjs — sliced features (spec §3.8, D13–D14): the durable record, the chained slice tickets,
// the feature card's view and its actions. Engine side, ungated (D12): only reached for runs that carry `shape`;
// every route that reaches it is gated (ui/server.mjs).
import { randomUUID } from 'node:crypto';
import { getDb, tx } from '../db.mjs';                  // node:sqlite: tx(fn), never db.transaction (F23)
import { createTicket, getTicket, cancelTicket, updateTicket, previousBranchesOf, stackedPrBaseOf } from '../scheduler.mjs';
import { readPrState, readPipelineExtras, readRunResultsById, readClarifyRow } from '../artifacts.mjs';
import { projectKey } from '../store.mjs';
import { sliceBrief, replanBrief } from '../../shared/shape/slices.mjs';
import { latestChecklist, checklistMarkdown } from '../../shared/shape/review-checklist.mjs';
import { buildDecisionLog } from '../../shared/shape/feature-log.mjs';
import { PLAN_ASK_KIND } from './run.mjs';
import { roundsOf } from './rounds.mjs';
import { getWatch, stoppedWatchFact } from '../pr-watch.mjs';
import { clipTitle } from '../title.mjs';
import { readRunTags } from '../run-tags-store.mjs';
import { readRunLabels } from '../run-labels-store.mjs';

const j = (t, d) => { try { return t ? JSON.parse(t) : d; } catch { return d; } };
const iso = (ms) => new Date(ms).toISOString();
const FILES_IN_SCOPE = 25;

export const SLICE_TITLE_MAX = 40;

/** A slice run's title (review D): "Run 2 · Pin charts". The feature name lives in the run's "Part of …" row; the
 *  feature title and total stay in the signature for the callers. */
export function sliceTitle(featureTitle, index, total, slice) {
  return `Run ${index} · ${clipTitle(slice && slice.title, SLICE_TITLE_MAX) || `slice ${index}`}`;
}

/** F24: a stored request's run options. A fired ticket reads its model and starter from `request.internal`
 *  (ui/server.mjs:1985-1992, :2331); `engine`, `mock` and `guardrailsId` are ordinary top-level body fields. */
function requestOptions(base = {}, startedBy = null) {
  const { model, ...top } = base;
  return { top, internal: { ...(startedBy ? { startedBy } : {}), ...(model ? { model } : {}) } };
}

/** A slice ticket's stored request (L6): what POST /api/run would take, plus `internal`. */
export function sliceRequest({ feature, index, outline, perspectives, workflowId, base = {}, projectDir, startedBy = null, sourceBranch = null }) {
  const total = outline.slices.length;
  const { top, internal } = requestOptions(base, startedBy);
  return {
    projectDir,
    prompt: sliceBrief({ featureTitle: feature.title, outline, index }),
    title: sliceTitle(feature.title, index, total, outline.slices[index - 1]),
    workflowId,
    ...top,
    ...(sourceBranch ? { sourceBranch } : {}),
    shape: { perspectives: [...perspectives], slices: 'off', slice: { feature: feature.id, index, total, outline } },
    internal,
  };
}

/** L5: the feature row, its slice rows and the chained tickets for slices 2..N, in one transaction. Idempotent per
 *  slice-1 pipeline: an earlier active feature of the same run is cancelled and marked replanned (§5.3 note). */
// node:sqlite refuses to bind `undefined`: every bound value has a default.
export function createSliceFeature({ pipelineId, projectDir, title, outline, proposed = null, merges = 0, removals = 0,
  approveEach = false, perspectives, workflowId, base = {}, replaces = null, startedBy = null, now = Date.now() }) {
  const db = getDb();
  const id = `feat_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const ts = iso(now);
  const total = outline.slices.length;
  const feature = { id, title };
  // One tx (F23): synchronous only, never nested. createTicket/cancelTicket open no tx of their own.
  tx(() => {
    // F48: by origin, not by slice 1's row: a restarted slice 1 points its row at a new ticket.
    const prior = db.prepare("SELECT id FROM shape_features WHERE origin_pipeline_id = ? AND status = 'active'").all(String(pipelineId));
    for (const p of prior) { cancelOpenTickets(p.id, { by: startedBy, now }); markReplaced(p.id, id, ts); }
    db.prepare(`INSERT INTO shape_features (id, title, project_dir, origin_pipeline_id, source_branch, outline, request_base,
      perspectives, workflow_id, approve_each, status, proposed, merges, removals, replaces, replaced_by, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, NULL, ?, ?, ?)`)
      .run(id, title, projectDir, String(pipelineId), sourceOf(pipelineId), JSON.stringify(outline), JSON.stringify(base),
        JSON.stringify(perspectives), workflowId, approveEach ? 1 : 0, proposed, merges, removals, replaces, startedBy, ts, ts);
    const addSlice = db.prepare('INSERT INTO shape_feature_slices (feature_id, idx, slice_id, title, ticket_id, pipeline_id) VALUES (?, ?, ?, ?, ?, ?)');
    addSlice.run(id, 1, outline.slices[0].id, outline.slices[0].title, null, pipelineId);
    let prev = { kind: 'pipeline', id: pipelineId };
    for (let k = 2; k <= total; k++) {
      const s = outline.slices[k - 1];
      const t = createTicket({
        title: sliceTitle(title, k, total, s), projectDir,
        request: sliceRequest({ feature, index: k, outline, perspectives, workflowId, base, projectDir, startedBy }),
        after: prev, afterPolicy: 'done', sourceFromPrevious: true, createdBy: startedBy, now,
      });
      addSlice.run(id, k, s.id, s.title, t.id, null);
      prev = { kind: 'ticket', id: t.id };
    }
    if (replaces) markReplaced(replaces, id, ts);
  });
  return { id, total };
}

/** L5: cancel every active feature whose outline this pipeline approved (origin, F48: an outline approved before a crash, then not
 *  approved on its re-offer). @returns {number} features retired */
export function retireFeaturesOf(pipelineId, { by = null, now = Date.now() } = {}) {
  const db = getDb();
  const ids = db.prepare("SELECT id FROM shape_features WHERE origin_pipeline_id = ? AND status = 'active'")
    .all(String(pipelineId)).map((r) => r.id);
  if (!ids.length) return 0;
  tx(() => {
    for (const fid of ids) {
      cancelOpenTickets(fid, { by, now });
      db.prepare("UPDATE shape_features SET status = 'canceled', updated_at = ? WHERE id = ?").run(iso(now), fid);
    }
  });
  return ids.length;
}

function markReplaced(oldId, newId, ts) {
  getDb().prepare("UPDATE shape_features SET status = 'replanned', replaced_by = ?, updated_at = ? WHERE id = ? AND status IN ('active', 'replanning')")
    .run(newId, ts, oldId);
}

/** D19: the feature's Clarify answers: its origin run's (slice 1, or the Re-plan the rest run) clarify row. */
export function featureClarify(featureId) {
  const f = getDb().prepare('SELECT origin_pipeline_id FROM shape_features WHERE id = ?').get(String(featureId));
  if (!f) return null;
  const row = readClarifyRow(f.origin_pipeline_id);
  return row && (row.questions || row.answers) ? row : null;
}

export function featureApprovesEach(id) {
  try { const r = getDb().prepare('SELECT approve_each FROM shape_features WHERE id = ?').get(String(id)); return !r || r.approve_each !== 0; }
  catch { return true; }
}

export function setApproveEach(id, on, { now = Date.now() } = {}) {
  return getDb().prepare('UPDATE shape_features SET approve_each = ?, updated_at = ? WHERE id = ?').run(on ? 1 : 0, iso(now), String(id)).changes > 0;
}

/** s2: what a Shaper run started without a predecessor carries from the feature's origin run: its cost tags and labels. */
function originCarry(f) {
  const pid = f && f.origin_pipeline_id;
  if (!pid) return {};
  const tags = readRunTags(pid); const labels = readRunLabels(pid);
  return { ...(tags.length ? { tags } : {}), ...(labels.length ? { labels } : {}) };
}

function featureRow(id) {
  const f = getDb().prepare('SELECT * FROM shape_features WHERE id = ?').get(String(id));
  if (!f) return null;
  return { ...f, outline: j(f.outline, { why: '', slices: [] }), base: j(f.request_base, {}), perspectives: j(f.perspectives, []) };
}

function sliceRows(featureId) {
  return getDb().prepare('SELECT * FROM shape_feature_slices WHERE feature_id = ? ORDER BY idx').all(String(featureId)).map((r) => {
    const ticket = r.ticket_id ? getTicket(r.ticket_id) : null;
    return { index: r.idx, sliceId: r.slice_id, title: r.title, ticketId: r.ticket_id, ticket,
      pipelineId: r.pipeline_id || ticket?.pipelineId || null, draftPrUrl: r.draft_pr_url || null, kind: r.kind || null };
  });
}

// The seven ticket statuses (scheduler.mjs:38).
const TICKET_STATE = { scheduled: 'planned', firing: 'starting', fired: 'starting', missed: 'missed', canceled: 'canceled', skipped: 'canceled', failed: 'failed' };
const PIPELINE_STATE = { done: 'done', stopped: 'stopped', error: 'error', paused: 'paused', interrupted: 'paused',
  created: 'starting', starting: 'starting' };
const HALTS = new Set(['stopped', 'error', 'failed', 'paused']);
// F43: a slice whose ticket was missed or canceled behind a done slice (archived predecessor, a predecessor that
// never got a pipeline, a cancel from the Schedules page) will never start by itself: it halts the feature too.
const STUCK = new Set(['missed', 'canceled']);

/** L8. `live(pipelineId)` → {runId, status, waiting:boolean, asking:boolean, approved:boolean} | null — the
 *  server's runs map. `waiting` is a pending `plan` ask; `asking` any other pending ask (Clarify's questions). */
function sliceState(row, live) {
  if (!row.pipelineId) return row.ticket ? (TICKET_STATE[row.ticket.status] || 'planned') : 'planned';
  const l = live(row.pipelineId);
  if (l) return l.waiting ? 'approval' : l.asking ? 'questions' : l.status === 'paused' ? 'paused' : l.approved ? 'running' : 'shaping';
  const p = getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get(row.pipelineId);
  return (p && PIPELINE_STATE[p.status]) || 'starting';
}

/** L8: the runs-map entry as featureView's `live` reads it (ui/server.mjs liveSliceOf). `waiting` is a pending plan
 *  ask, `asking` any other pending ask; `ask` names it for the feature card's open step (s2, D9). */
export function liveSliceFrom({ runId, status, pendingQuestion = null, approved = false }) {
  const pq = pendingQuestion || null;
  const plan = !!pq && pq.kind === PLAN_ASK_KIND;
  return { runId, status: String(status || ''), waiting: plan, asking: !!pq && !plan, approved: !!approved,
    ask: pq ? { id: pq.id || null, kind: plan && pq.plan && pq.plan.outline ? 'outline' : pq.kind } : null };
}

const auditTexts = (pid) => (pid ? getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ? ORDER BY id').all(String(pid)).map((r) => r.text) : []);
function clarifyOf(pid) {
  const r = readClarifyRow(pid);
  return { questions: Array.isArray(r.questions?.questions) ? r.questions.questions : [], answers: Array.isArray(r.answers?.answers) ? r.answers.answers : [] };
}
/** D7: the feature card's step log, from the origin run's clarify row and audit lines, each later run's audit lines,
 *  and (while re-planning) every run after the last done one: replanBrief re-plans the halted run with the canceled. */
function featureLog(f, slices) {
  const lastDone = Math.max(0, ...slices.filter((s) => s.state === 'done').map((s) => s.index));
  const replan = f.status === 'replanning' || f.status === 'replanned'
    ? slices.filter((s) => s.index > lastDone).map((s) => s.index) : null;
  return buildDecisionLog({
    clarify: clarifyOf(f.origin_pipeline_id), origin: auditTexts(f.origin_pipeline_id), sliced: true,
    runs: slices.filter((s) => s.index > 1 && s.pipelineId).map((s) => ({ index: s.index, events: auditTexts(s.pipelineId) })),
    slices: slices.map((s) => {
      const o = f.outline.slices[s.index - 1] || {};
      return { index: s.index, title: s.title, goal: o.goal || '', acceptance: Array.isArray(o.acceptance) ? o.acceptance : [] };
    }),
    replan,
    rounds: slices.flatMap((s) => (s.rounds || []).map((r) => ({ run: s.index, ...r }))),
  });
}

export function featureView(id, { live = () => null } = {}) {
  const f = featureRow(id);
  if (!f) return null;
  let ask = null;
  const rows = sliceRows(id);
  const rounds = roundsOf(rows.map((r) => r.pipelineId));
  const slices = rows.map((r) => {
    const state = sliceState(r, live);
    const l = r.pipelineId ? live(r.pipelineId) : null;
    if (!ask && l && l.ask) ask = { index: r.index, runId: l.runId || null, pipelineId: r.pipelineId, id: l.ask.id, kind: l.ask.kind };
    const pr0 = r.pipelineId ? readPrState(r.pipelineId) : null;
    // D24: a slice draft (opened before the one ship flow) reads "draft" until the feature ships (pr_state stays OPEN, P18).
    const pr = pr0 ? { ...pr0, draft: !f.ship_mode && !!r.draftPrUrl && r.draftPrUrl === pr0.url } : null;
    const s = f.outline.slices[r.index - 1] || {};
    return { index: r.index, title: r.title, goal: s.goal || '', estimate: s.estimate || null, state,
      runId: l?.runId || null, pipelineId: r.pipelineId, ticketId: r.ticketId, pr,
      kind: r.kind || null, rounds: (r.pipelineId && rounds.get(r.pipelineId)) || [],
      watch: pr && pr.url ? stoppedWatchFact(getWatch(pr.url)) : null };
  });
  const roundLive = slices.some((s) => s.rounds.some((x) => LIVE_ROUND.has(x.status)));
  const ideas = getDb().prepare(`SELECT COUNT(*) AS n FROM shape_feature_notes WHERE feature_id = ? AND kind = 'idea'
    AND (run_index IS NULL OR run_index NOT IN (SELECT idx FROM shape_feature_slices WHERE feature_id = ? AND pipeline_id IS NOT NULL))`).get(f.id, f.id).n;
  const done = slices.filter((s) => s.state === 'done').length;
  const h = slices.find((s, i) => HALTS.has(s.state) || (i > 0 && STUCK.has(s.state) && slices[i - 1].state === 'done'));
  const waiting = h ? slices.filter((s) => s.index > h.index && (s.state === 'planned' || s.state === 'missed')).map((s) => s.index) : [];
  const status = f.status === 'active' && done === slices.length ? 'done' : f.status;
  // D24: Ship as once every slice is done, on a feature that is still active and not shipped. The suggestion is
  // async (featureShipSuggestion); the GET route merges it.
  const lastPrUrl = slices.length ? (slices[slices.length - 1].pr?.url || null) : null;
  const release = f.release_version ? { version: f.release_version, url: f.release_url || null, error: f.release_error || null } : null;
  const ship = { ready: slices.length > 0 && done === slices.length && f.status === 'active' && !f.ship_mode && !roundLive,
    mode: f.ship_mode || null, prUrl: f.ship_pr_url || null, lastPrUrl, suggested: null, linesAdded: null,
    linesRemoved: null, files: null, release,
    // s4: what the applied Ship card shows, wherever it renders (chat, group page, Plans).
    result: f.ship_mode ? { mode: f.ship_mode, prUrl: f.ship_pr_url || lastPrUrl,
      closed: f.ship_mode === 'one' ? (f.ship_closed ?? slices.filter((s) => s.pr && s.pr.state === 'CLOSED').length) : 0, release } : null };
  // The Re-plan the rest run (replanning/replanned): its ticket id is the run id it fires as (ui/server.mjs:2188).
  const rt = f.replan_ticket_id ? getTicket(f.replan_ticket_id) : null;
  const replan = rt ? { ticketId: rt.id, pipelineId: rt.pipelineId || null, runId: rt.pipelineId ? (live(rt.pipelineId)?.runId || null) : null } : null;
  // s3 (D16): while re-planning, no slice asks; the Re-plan the rest run's Split ask is the card's open step.
  if (!ask && f.status === 'replanning' && replan && replan.pipelineId) {
    const l = live(replan.pipelineId);
    if (l && l.ask) ask = { index: null, runId: l.runId || null, pipelineId: replan.pipelineId, id: l.ask.id, kind: l.ask.kind };
  }
  return {
    id: f.id, title: f.title, projectKey: projectKey(f.project_dir),   // a History link needs it (F28)
    status, approveEach: f.approve_each !== 0, total: slices.length, done,
    halted: h ? { index: h.index, state: h.state, waiting } : null,
    open: slices.some((s) => ['planned', 'missed'].includes(s.state)),
    replacedBy: f.replaced_by || null, replan, slices, ship,
    originPipelineId: f.origin_pipeline_id, ask, log: featureLog(f, slices), notes: { ideas },
  };
}

export const ONE_PR_MAX_LINES = 1500;

const NOT_STARTED = new Set(['planned', 'missed']);
const LIVE_ROUND = new Set(['running', 'starting', 'paused']);

/** Shaper s5 (D11): a note on the feature for the next run not started yet (NULL when none is left). A plan note
 *  with no run left to plan is not stored ({id: null, runIndex: null}): the card's caller refuses it. */
export function addFeatureNote(featureId, { kind, text, by = null, now = Date.now() }) {
  if (kind !== 'plan' && kind !== 'idea') throw new TypeError('kind must be plan or idea');
  const v = featureView(featureId);
  if (!v) return null;
  const next = v.slices.find((s) => NOT_STARTED.has(s.state));
  if (kind === 'plan' && !next) return { id: null, runIndex: null };
  const id = `note_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  getDb().prepare('INSERT INTO shape_feature_notes (id, feature_id, kind, text, run_index, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, featureId, kind, String(text).slice(0, 4000), next ? next.index : null, by, iso(now));
  return { id, runIndex: next ? next.index : null };
}

/** The notes for run `index`, oldest first. */
export function featureNotes(featureId, index) {
  return getDb().prepare('SELECT kind, text FROM shape_feature_notes WHERE feature_id = ? AND run_index = ? ORDER BY created_at, rowid')
    .all(String(featureId), Number(index)).map((r) => ({ kind: r.kind, text: r.text }));
}

/** The feature's base branch (slice 1's source): what a later run merges first (D14) and a follow-up starts from (D13). */
export function featureBase(featureId) {
  return getDb().prepare('SELECT source_branch FROM shape_features WHERE id = ?').get(String(featureId))?.source_branch || null;
}

/** D16: the feature's live round, or null (the ship verbs refuse while one runs). */
export function liveRoundOf(featureId) {
  const pids = sliceRows(featureId).map((s) => s.pipelineId).filter(Boolean);
  for (const list of roundsOf(pids).values()) for (const r of list) if (LIVE_ROUND.has(r.status)) return r;
  return null;
}

/** Shaper s5 (D13): run N+1 of the feature. 'extra' chains after the last run; 'follow-up' fires now from the base. */
export function appendFeatureRun(featureId, { title, goal, kind, by = null, now = Date.now() }) {
  if (kind !== 'extra' && kind !== 'follow-up') throw new TypeError('kind must be extra or follow-up');
  const db = getDb();
  const f = featureRow(featureId);
  if (!f) return null;
  const rows = sliceRows(featureId);
  const index = rows.length + 1;
  const last = rows[rows.length - 1];
  const s = { id: `s${index}`, title: String(title).slice(0, 120), goal: String(goal || ''), inScope: [], outOfScope: [],
    acceptance: [], dependsOn: [], estimate: null };
  const outline = { ...f.outline, slices: [...f.outline.slices, s] };
  const feature = { id: f.id, title: f.title };
  let ticketId = null;
  tx(() => {
    const after = last.pipelineId ? { kind: 'pipeline', id: last.pipelineId } : { kind: 'ticket', id: last.ticketId };
    const t = createTicket({
      title: sliceTitle(f.title, index, index, s), projectDir: f.project_dir,
      request: { ...sliceRequest({ feature, index, outline, perspectives: f.perspectives, workflowId: f.workflow_id, base: f.base,
        projectDir: f.project_dir, startedBy: by, sourceBranch: kind === 'follow-up' ? f.source_branch : null }),
      ...(kind === 'follow-up' ? originCarry(f) : {}) },   // s2: a chained `extra` inherits at fire instead
      ...(kind === 'extra' ? { after, afterPolicy: 'done', sourceFromPrevious: true } : { runAtMs: now }),
      createdBy: by, now,
    });
    ticketId = t.id;
    db.prepare('INSERT INTO shape_feature_slices (feature_id, idx, slice_id, title, ticket_id, pipeline_id, kind) VALUES (?, ?, ?, ?, ?, NULL, ?)')
      .run(f.id, index, s.id, s.title, t.id, kind);
    db.prepare("UPDATE shape_features SET outline = ?, status = 'active', updated_at = ? WHERE id = ?").run(JSON.stringify(outline), iso(now), f.id);
    db.prepare('UPDATE shape_feature_notes SET run_index = ? WHERE feature_id = ? AND run_index IS NULL').run(index, f.id);
  });
  return { index, ticketId };
}

/** D24: a slice's draft PR (in-flight features from before the one ship flow), so the page can say "draft" (pipelines.pr_state stays OPEN, P18). */
export function recordSliceDraft(pipelineId, url) {
  const at = featureOfPipeline(pipelineId);
  if (!at) return false;
  return getDb().prepare('UPDATE shape_feature_slices SET draft_pr_url = ? WHERE feature_id = ? AND idx = ?')
    .run(String(url), at.featureId, at.idx).changes > 0;
}

/** D24: what Ship as did. Once: a second call changes nothing and answers false. s4: with the draft release chosen and
 *  how many drafts the one PR closed (shipFeature's count; NULL = unknown, the view counts CLOSED rows). */
export function recordShip(id, { mode, prUrl = null, closed = null, release = null, now = Date.now() }) {
  return getDb().prepare(`UPDATE shape_features SET ship_mode = ?, ship_pr_url = ?, ship_closed = ?, shipped_at = ?, updated_at = ?,
      release_version = ?, release_target = ? WHERE id = ? AND ship_mode IS NULL`)
    .run(mode, prUrl, Number.isInteger(closed) ? closed : null, iso(now), iso(now), release ? release.version : null,
      release ? (release.target || null) : null, String(id))
    .changes > 0;
}

/** P17: the Ship as default from the slices' frozen line counts (results.json summary.linesAdded; unknown = 0). Async:
 *  the run dir lookup is async, so this cannot live in sync featureView. */
export async function featureShipSuggestion(view) {
  let added = 0; let removed = 0; let files = 0;
  for (const s of view.slices) {
    if (!s.pipelineId) continue;
    try {
      const sum = (await readRunResultsById(s.pipelineId))?.summary || {};
      if (Number.isFinite(sum.linesAdded)) added += sum.linesAdded;
      if (Number.isFinite(sum.linesRemoved)) removed += sum.linesRemoved;
      // 'D' rows are already inside filesChanged (app.js summary rule): new + changed, never + deleted.
      files += (Number.isFinite(sum.filesNew) ? sum.filesNew : 0) + (Number.isFinite(sum.filesChanged) ? sum.filesChanged : 0);
    } catch { /* unknown counts as 0 */ }
  }
  return { suggested: added < ONE_PR_MAX_LINES ? 'one' : 'stacked', linesAdded: added, linesRemoved: removed, files };
}

/** D24, D25: what Ship as needs per slice: its PR, its last code review summary (capped as earlierSliceChanges caps
 *  it) and its checklist markdown. */
export async function featureShipInput(view) {
  const slices = [];
  for (const s of view.slices) {
    const reviews = s.pipelineId ? readPipelineExtras(s.pipelineId).reviews : [];
    const last = reviews.filter((v) => v.kind === 'impl' && v.summary).sort((a, b) => a.cycle - b.cycle).at(-1);
    const cl = latestChecklist(reviews);
    slices.push({ index: s.index, title: s.title, pipelineId: s.pipelineId, pr: s.pr,
      summary: last ? last.summary.slice(0, 600) : '', checklistMd: cl ? checklistMarkdown(cl.checklist).trimEnd() : '' });
  }
  return { id: view.id, title: view.title, slices };
}

/** F47: the newest feature in a Re-plan the rest chain (replaced_by), so a host pointed at an old feature shows the
 *  one that carries on. Bounded: a corrupt loop stops after REPLAN_HOPS. */
const REPLAN_HOPS = 10;
export function currentFeatureId(id) {
  const q = getDb().prepare('SELECT replaced_by FROM shape_features WHERE id = ?');
  let cur = String(id);
  for (let i = 0; i < REPLAN_HOPS; i++) {
    const r = q.get(cur);
    if (!r || !r.replaced_by) return cur;
    cur = r.replaced_by;
  }
  return cur;
}

/** Shaper s2 (D10): what the Chat feature card reads for the run its thread started — the feature view (log and open
 *  ask included) once the outline is approved, else, for a run `shaped(pid)` names (its runs-map entry carries
 *  orch.state.shaping), the run's own decision log. null for an unknown run and for a plain one. */
export function shaperCard(pipelineId, { live = () => null, shaped = () => false } = {}) {
  const pid = String(pipelineId);
  if (!getDb().prepare('SELECT 1 FROM pipelines WHERE id = ?').get(pid)) return null;
  const at = featureOfPipeline(pid);
  const feature = at ? featureView(currentFeatureId(at.featureId), { live }) : null;
  if (!feature && !shaped(pid)) return null;
  return { pipelineId: pid, feature, log: feature ? feature.log : buildDecisionLog({ clarify: clarifyOf(pid), origin: auditTexts(pid) }) };
}

/** Shaper s2 (D14): the Chat thread that started a feature — its origin run's link row — walking `replaces` back
 *  through Re-plan the rest (that run has no link of its own). null when no thread started it (a CLI run). */
export function featureThread(featureId) {
  const feat = getDb().prepare('SELECT origin_pipeline_id AS pid, replaces FROM shape_features WHERE id = ?');
  const link = getDb().prepare('SELECT thread_id AS threadId, card_id AS cardId FROM ask_run_links WHERE pipeline_id = ? ORDER BY created_at LIMIT 1');
  let cur = featureId ? String(featureId) : null;
  for (let i = 0; i < REPLAN_HOPS && cur; i++) {
    const f = feat.get(cur);
    if (!f) return null;
    const l = link.get(f.pid);
    if (l) return { threadId: l.threadId, cardId: l.cardId || null };
    cur = f.replaces || null;
  }
  return null;
}

/** The feature whose slice ran as this pipeline: the run that approved the outline (origin, F48), slice 1 by row,
 *  later slices and restarts through their ticket. After an idempotent re-create, a replanned feature has the same
 *  origin: prefer the active one, then the newest. */
export function featureOfPipeline(pipelineId) {
  const pid = String(pipelineId);
  const r = getDb().prepare(`SELECT featureId, idx FROM (
      SELECT f.id AS featureId, 1 AS idx, f.status AS status, f.created_at AS createdAt FROM shape_features f
        WHERE f.origin_pipeline_id = ?
      UNION ALL
      SELECT s.feature_id, s.idx, f.status, f.created_at FROM shape_feature_slices s
        JOIN shape_features f ON f.id = s.feature_id
        LEFT JOIN scheduled_runs t ON t.id = s.ticket_id WHERE s.pipeline_id = ? OR t.pipeline_id = ?)
    ORDER BY (status = 'active') DESC, createdAt DESC LIMIT 1`).get(pid, pid, pid);
  return r || null;
}

export function featuresOfTickets(ids) {
  if (!ids.length) return [];
  return getDb().prepare(`SELECT DISTINCT feature_id FROM shape_feature_slices WHERE ticket_id IN (${ids.map(() => '?').join(', ')})`)
    .all(...ids.map(String)).map((r) => r.feature_id);
}

/** D17: the feature a Run after chain shows, when the chain's first run is one of its slices. */
export function chainFeature(members) {
  const m0 = Array.isArray(members) ? members[0] : null;
  if (!m0) return null;
  const fid = m0.pipelineId ? featureOfPipeline(m0.pipelineId)?.featureId : m0.ticketId ? featuresOfTickets([m0.ticketId])[0] : null;
  if (!fid) return null;
  const f = getDb().prepare('SELECT id, title FROM shape_features WHERE id = ?').get(String(fid));
  if (!f) return null;
  return { id: f.id, title: f.title,
    slices: sliceRows(f.id).map((r) => ({ index: r.index, title: r.title, ticketId: r.ticketId, pipelineId: r.pipelineId })) };
}

/** D16, D22: where a run sits in its feature, or null. */
export function sliceOfPipeline(pipelineId, { live = () => null } = {}) {
  const at = featureOfPipeline(pipelineId);
  if (!at) return null;
  const v = featureView(at.featureId, { live });
  if (!v) return null;
  const s = v.slices[at.idx - 1];
  const n = v.slices[at.idx] || null;
  return { featureId: v.id, title: v.title, index: at.idx, total: v.total, sliceTitle: s ? s.title : '',
    state: s ? s.state : null, next: n ? { index: n.index, title: n.title, state: n.state } : null };
}

/** D22: the first lines of a slice's PR body: which feature, which slice, and the other slices' PRs. */
export function slicePrPreamble(pipelineId) {
  const at = featureOfPipeline(pipelineId);
  if (!at) return '';
  const f = featureRow(at.featureId);
  if (!f) return '';
  const rows = sliceRows(f.id);
  const others = rows.filter((r) => r.index !== at.idx).map((r) => {
    const pr = r.pipelineId ? readPrState(r.pipelineId) : null;
    return `- Slice ${r.index}, ${r.title}: ${pr?.url || 'not opened yet'}`;
  });
  return `Part of ${f.title}: slice ${at.idx} of ${rows.length}\n\n${others.join('\n')}`;
}

/** L6, D14: each done earlier slice's last review summary and changed files (results.json), oldest first. */
export async function earlierSliceChanges(featureId, index) {
  const out = [];
  for (const r of sliceRows(featureId).filter((x) => x.index < index && x.pipelineId)) {
    const res = await readRunResultsById(r.pipelineId);
    const files = [...(res?.newFiles || []), ...(res?.changedFiles || [])].map((x) => x.path).filter(Boolean);
    // F31: reviews come ORDER BY kind, cycle. The code review is kind 'impl'; take its highest cycle with a summary.
    const last = readPipelineExtras(r.pipelineId).reviews
      .filter((v) => v.kind === 'impl' && v.summary).sort((a, b) => a.cycle - b.cycle).at(-1);
    out.push({ index: r.index, title: r.title, summary: last ? last.summary.slice(0, 600) : '',
      files: files.slice(0, FILES_IN_SCOPE), more: Math.max(0, files.length - FILES_IN_SCOPE) });
  }
  return out;
}

function cancelOpenTickets(featureId, { by, now }) {
  let n = 0;
  for (const r of sliceRows(featureId)) if (r.ticket && ['scheduled', 'missed'].includes(r.ticket.status) && cancelTicket(r.ticketId, { by, now })) n += 1;
  return n;
}

/** The feature actions act on an active feature only (L9). @returns {null|{error:string, status:number}} */
function notActive(f) {
  return f.status === 'active' ? null : { status: 409, error: `this feature is ${f.status}` };
}

/** Cancel the rest (L9). A running slice is left alone: it is stopped from its own card. */
export function cancelRest(id, { by = null, now = Date.now() } = {}) {
  const f = featureRow(id);
  if (!f) return null;
  const refused = notActive(f);
  if (refused) return refused;
  let canceled = 0;
  tx(() => {
    canceled = cancelOpenTickets(id, { by, now });
    getDb().prepare("UPDATE shape_features SET status = 'canceled', updated_at = ? WHERE id = ?").run(iso(now), id);
  });
  return { canceled };
}

/** The branch slice 1 started from (stored on the feature at creation; for restarting slice 1). */
function sourceOf(pipelineId) {
  if (!pipelineId) return null;
  const row = getDb().prepare('SELECT branch FROM pipelines WHERE id = ?').get(String(pipelineId));
  return j(row?.branch, null)?.source || null;
}

/** After slice `index` is resumed (F30): its `missed` successors go back to `scheduled`, each re-chained to the ref
 *  it already had. A fresh ref is never introduced, so no cycle can form (updateTicket has no cycle check). */
export function rechainWaiting(id, index, { by = null, now = Date.now() } = {}) {
  let n = 0;
  tx(() => {
    for (const r of sliceRows(id).slice(index)) {
      if (!r.ticket) break;
      if (r.ticket.status === 'scheduled') continue;
      if (r.ticket.status !== 'missed' || !r.ticket.after) break;
      updateTicket(r.ticketId, { after: { kind: r.ticket.after.kind, id: r.ticket.after.id } }, { now, by });
      n += 1;
    }
  });
  return n;
}

/** Resume slice k (L9). Paused/interrupted → the caller resumes the pipeline, then calls rechainWaiting.
 *  Stopped/error/failed, or missed/canceled behind a done slice (F43) → a new ticket for slice k, re-chained so the
 *  waiting slices follow it.
 *  @returns {null|{error, status}|{action:'resume', pipelineId, index}|{action:'restart', ticketId}|{action:'none'}} */
export function resumeFeature(id, { live = () => null, by = null, now = Date.now() } = {}) {
  const f = featureRow(id);
  if (!f) return null;
  const refused = notActive(f);
  if (refused) return refused;
  const view = featureView(id, { live });
  if (!view.halted) return { action: 'none' };
  const h = view.slices[view.halted.index - 1];
  // The route resumes it like /api/resume, in the run's own mock mode, then calls rechainWaiting (F30).
  if (h.state === 'paused') return { action: 'resume', pipelineId: h.pipelineId, index: h.index, mock: f.base.mock === true };
  const rows = sliceRows(id);
  const prev = h.index > 1 ? rows[h.index - 2] : null;
  // F43: createTicket throws on {kind:'pipeline', id:null}. A previous slice with no pipeline has not run (e.g. this
  // slice was started early with Run now): nothing to chain after.
  if (prev && !prev.pipelineId) return { status: 409, error: `slice ${prev.index} has not run yet: start it first` };
  const request = { ...sliceRequest({ feature: { id, title: f.title }, index: h.index, outline: f.outline, perspectives: f.perspectives,
    workflowId: f.workflow_id, base: f.base, projectDir: f.project_dir, startedBy: by,
    sourceBranch: prev ? null : f.source_branch || null }), ...(prev ? {} : originCarry(f)) };   // s2: chained restarts inherit at fire
  let ticketId = null;
  tx(() => {
    const t = createTicket({
      title: sliceTitle(f.title, h.index, rows.length, f.outline.slices[h.index - 1]), projectDir: f.project_dir, request,
      ...(prev ? { after: { kind: 'pipeline', id: prev.pipelineId }, afterPolicy: 'done', sourceFromPrevious: true } : { runAtMs: now }),
      createdBy: by, now,
    });
    ticketId = t.id;
    // The row now follows the new ticket. For k = 1 the thread's run stays reachable through origin_pipeline_id (F48).
    getDb().prepare('UPDATE shape_feature_slices SET ticket_id = ?, pipeline_id = NULL WHERE feature_id = ? AND idx = ?').run(t.id, id, h.index);
    // The new ticket is fresh, so pointing the next slice at it cannot form a cycle; later ones keep their own ref.
    let after = { kind: 'ticket', id: t.id };
    for (const r of rows.slice(h.index)) {
      if (!r.ticket || !['scheduled', 'missed'].includes(r.ticket.status)) break;
      updateTicket(r.ticketId, { after }, { now, by });
      after = { kind: 'ticket', id: r.ticketId };
    }
  });
  return { action: 'restart', ticketId };
}

const BUSY = new Set(['starting', 'shaping', 'questions', 'approval', 'running']);

/** Re-plan the rest (L9): cancel what waits, then one new shaped run (slicing on) from the last done slice. */
export function replanRest(id, { live = () => null, by = null, now = Date.now() } = {}) {
  const f = featureRow(id);
  if (!f) return null;
  const refused = notActive(f);
  if (refused) return refused;
  const view = featureView(id, { live });
  const busy = view.slices.find((s) => BUSY.has(s.state));
  if (busy) return { status: 409, error: `Slice ${busy.index} is still going: stop it first, then re-plan the rest` };
  const lastDone = [...view.slices].reverse().find((s) => s.state === 'done');
  // previousBranchesOf → {sourceBranch} | {pending:true} | null (scheduler.mjs:504): the done slice's work branch.
  const prev = lastDone ? previousBranchesOf(lastDone.pipelineId) : null;
  if (prev?.pending) return { status: 409, error: 'the last finished slice is still merging its work back: try again in a moment' };
  if (lastDone && !prev?.sourceBranch) return { status: 409, error: `slice ${lastDone.index} has no branch to start from` };
  const branch = lastDone ? prev.sourceBranch : f.source_branch || null;
  const { top, internal } = requestOptions(f.base, by);
  const request = {
    projectDir: f.project_dir, prompt: replanBrief({ featureTitle: f.title, outline: f.outline, doneCount: view.done }),
    title: `${f.title} · re-plan`, workflowId: f.workflow_id, ...top, ...(branch ? { sourceBranch: branch } : {}),
    ...originCarry(f),
    shape: { perspectives: f.perspectives, slices: 'auto', replaces: id },
    internal,
  };
  let ticketId = null;
  tx(() => {
    cancelOpenTickets(id, { by, now });
    ticketId = createTicket({ title: request.title, projectDir: f.project_dir, request, runAtMs: now, createdBy: by, now }).id;
    getDb().prepare("UPDATE shape_features SET status = 'replanning', replan_ticket_id = ?, updated_at = ? WHERE id = ?").run(ticketId, iso(now), id);
  });
  return { ticketId };
}

/** L10: a slice's PR base — the generic stacked base (scheduler.mjs stackedPrBaseOf); a slice is one chained run. */
export function stackedPrBase(pipelineId, chain) {
  return stackedPrBaseOf(pipelineId, chain);
}

/** L12: a shaped run started from a Chat card (Plans tab). */
export function recordShapePlan({ threadId, cardId, title, now = Date.now() }) {
  getDb().prepare('INSERT OR IGNORE INTO shape_plans (thread_id, card_id, title, created_at) VALUES (?, ?, ?, ?)')
    .run(threadId, cardId, title || null, iso(now));
}

/** The Plans tab rows, newest first: the plan, its thread's link row, and the feature its pipeline started. */
export function listShapePlans({ limit = 30 } = {}) {
  // The run's own title (set by its `title` event) wins over the launch title recorded with the card.
  return getDb().prepare(`SELECT p.thread_id AS threadId, p.card_id AS cardId, COALESCE(pl.title, p.title) AS title, p.created_at AS createdAt,
      l.run_id AS runId, l.pipeline_id AS pipelineId, l.status AS linkStatus, pl.status AS pipelineStatus,
      t.title AS threadTitle
    FROM shape_plans p
    LEFT JOIN ask_run_links l ON l.thread_id = p.thread_id AND l.card_id = p.card_id
    LEFT JOIN pipelines pl ON pl.id = l.pipeline_id
    LEFT JOIN ask_threads t ON t.id = p.thread_id
    ORDER BY p.created_at DESC LIMIT ?`).all(limit)
    .map((r) => ({ ...r, featureId: r.pipelineId ? (featureOfPipeline(r.pipelineId)?.featureId || null) : null }));
}
