// src/core/shape/features.mjs — sliced features (spec §3.8, D13–D14): the durable record, the chained slice tickets,
// the feature card's view and its actions. Engine side, ungated (D12): only reached for runs that carry `shape`;
// every route that reaches it is gated (ui/server.mjs).
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { guardedGitEnvSync } from '../git-guard.mjs';
import { getDb, tx } from '../db.mjs';                  // node:sqlite: tx(fn), never db.transaction (F23)
import { createTicket, getTicket, cancelTicket, updateTicket, previousBranchesOf, stackedPrBaseOf, predecessorState, requestRunNow, workBranchOf } from '../scheduler.mjs';
import { shipChain } from './ship.mjs';
import { readPrState, readPipelineExtras, readRunResultsById, readClarifyRow, listRunArtifacts } from '../artifacts.mjs';
import { projectKey } from '../store.mjs';
import { sliceBrief, replanBrief } from '../../shared/shape/slices.mjs';
import { normalizeCare, normalizeRequirementKinds, careOfRow, requirementKindsOf, careRunPlan } from '../../shared/shape/feature-record.mjs';
import { shaperSmallRunsOn, smallRunsOfFeature, smallRunsOfPipeline, careOfPipeline, careOfFeature, prototypeOfPipeline } from './small-runs.mjs';
import { prototypeView } from '../../shared/shape/prototype.mjs';
import { planVersionOf, startsFromOf, ownsOf } from '../../shared/shape/run-facts.mjs';
import { requirementsCheck } from '../../shared/review/requirements-coverage.mjs';
import { acceptanceGate, ledgerCheck } from '../../shared/shape/acceptance.mjs';
import { shipLedger, unownedReason, careOutcome, unmetLines } from '../../shared/shape/ship-ledger.mjs';
import { rerunsOf } from '../../shared/shape/req-status.mjs';
import { latestChecklist, checklistMarkdown } from '../../shared/shape/review-checklist.mjs';
import { buildDecisionLog } from '../../shared/shape/feature-log.mjs';
import { stopOptionOf } from '../../shared/shape/run-stops.mjs';
import { holdsUpOf, namedWaits, neededByOf } from '../../shared/shape/run-status.mjs';
import { CHANGES_MAX } from '../../shared/shape/req-change.mjs';
import { PLAN_ASK_KIND } from './run.mjs';
import { SHAPE_SLICE_REQ_WORKFLOW_ID, SHAPE_UX_SLICE_REQ_WORKFLOW_ID } from '../graph/builtin-workflows.mjs';
import { roundsOf } from './rounds.mjs';
import { refuseWhileShipping } from './ship-lock.mjs';
import { verifyView, startVerifyCheck, stillFinishing, roundOpen, shipRuleOn } from './verifier.mjs';
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

/** Small runs C2: a marked feature whose Care has no separate Test writer (Lean) asks its runs for the tests first. */
function testsFirstOf(featureId) {
  if (!featureId || !smallRunsOfFeature(featureId)) return false;
  const care = careOfFeature(featureId);
  return !!care && careRunPlan(care.position).testWriter === false;
}

/** A slice ticket's stored request (L6): what POST /api/run would take, plus `internal`. */
export function sliceRequest({ feature, index, outline, perspectives, workflowId, base = {}, projectDir, startedBy = null, sourceBranch = null,
  requirementsFirst = false }) {
  const total = outline.slices.length;
  const { top, internal } = requestOptions(base, startedBy);
  return {
    projectDir,
    prompt: sliceBrief({ featureTitle: feature.title, outline, index, testsFirst: testsFirstOf(feature.id) }),
    title: sliceTitle(feature.title, index, total, outline.slices[index - 1]),
    workflowId,
    ...top,
    ...(sourceBranch ? { sourceBranch } : {}),
    shape: { perspectives: [...perspectives], slices: 'off', slice: { feature: feature.id, index, total, outline },
      ...(requirementsFirst ? { requirementsFirst: true } : {}) },
    internal,
  };
}

/** Shaper small runs A2: the Care values and requirement kinds a new feature stores, validated before anything is
 *  written. A re-plan keeps the replaced feature's Care, and its confirmed kinds for ids still agreed, when the caller
 *  passes none; the replaced row is read tolerantly, so it never refuses the re-plan. Throws an Error carrying `code`. */
function featureRecord({ care, requirementKinds, replaces, outline }) {
  const agreed = Array.isArray(outline.agreed) ? outline.agreed : [];
  const kept = replaces && (care === null || requirementKinds === null)
    ? getDb().prepare('SELECT care, care_chosen_by, care_worca_pick, requirement_kinds FROM shape_features WHERE id = ?').get(String(replaces)) : null;
  const keptKinds = () => Object.fromEntries(requirementKindsOf(j(kept.requirement_kinds, null), outline)
    .filter((k) => k.kind === 'confirmed').map(({ id, kind, role }) => [id, { kind, role }]));
  const c = normalizeCare(care === null && kept ? careOfRow(kept) : care);
  const k = c.ok ? normalizeRequirementKinds(requirementKinds === null && kept ? keptKinds() : requirementKinds, agreed.map((a) => a.id)) : c;
  if (!k.ok) throw Object.assign(new Error(k.error), { code: k.code });
  return { care: c.care, kinds: agreed.length ? JSON.stringify(k.kinds) : null };
}

/** L5: the feature row, its slice rows and the chained tickets for slices 2..N, in one transaction. Idempotent per
 *  slice-1 pipeline: an earlier active feature of the same run is cancelled and marked replanned (§5.3 note).
 *  `care` and `requirementKinds` (Shaper small runs A2) are read only when `smallRuns` is true: the live flag by default,
 *  the origin run's marker when the orchestrator splits (B2 D10, d-3); a refused one throws before the tx. */
// node:sqlite refuses to bind `undefined`: every bound value has a default.
export function createSliceFeature({ pipelineId, projectDir, title, outline, proposed = null, merges = 0, removals = 0,
  approveEach = false, perspectives, workflowId, base = {}, replaces = null, startedBy = null, pr = null, care = null,
  requirementKinds = null, smallRuns = shaperSmallRunsOn(), now = Date.now() }) {
  const db = getDb();
  const record = smallRuns === true ? featureRecord({ care, requirementKinds, replaces, outline }) : null;
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
    if (record) db.prepare('UPDATE shape_features SET care = ?, care_chosen_by = ?, care_worca_pick = ?, requirement_kinds = ? WHERE id = ?')
      .run(record.care.position, record.care.chosenBy, record.care.worcaPick, record.kinds, id);
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
    // I3 (PR when done): the decision is written here and nowhere else. A re-plan keeps the replaced feature's, source included.
    const kept = replaces ? db.prepare('SELECT pr_open, pr_slices, pr_source FROM shape_features WHERE id = ?').get(String(replaces)) : null;
    const stored = kept && kept.pr_open ? kept : pr ? { pr_open: pr.open, pr_slices: pr.slices, pr_source: JSON.stringify(pr.source || {}) } : null;
    if (stored) db.prepare('UPDATE shape_features SET pr_open = ?, pr_slices = ?, pr_source = ? WHERE id = ?').run(stored.pr_open, stored.pr_slices, stored.pr_source, id);
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

/** D2: the scheduler's hold for "Ask me before each run". True only for a slice ticket of an active feature with the
 *  switch on; a non-slice ticket, a missing feature row or a DB error never holds (a broken lookup must not strand a run). */
export function featureHoldsTicket(ticket) {
  if (!ticket || !ticket.id) return false;
  try {
    const r = sliceOfTicket(ticket.id);
    return !!r && r.status === 'active' && (r.approveEach || !!clashHoldOf(ticket.id));
  } catch { return false; }
}

// Shaper small runs (D5): slice tickets held because the runs they build on clash, by ticket id. In memory only: after a
// restart the next tick fires the ticket, the combine check runs again and the hold comes back.
const CLASH_HOLDS = new Map();

/** The clash hold of a ticket while the flag is on, else null. → {reason, runs, files, at} | null */
export function clashHoldOf(ticketId) {
  if (!ticketId || !shaperSmallRunsOn()) return null;
  return CLASH_HOLDS.get(String(ticketId)) || null;
}

export function setClashHold(ticketId, hold) {
  if (ticketId) CLASH_HOLDS.set(String(ticketId), hold);
}

export function clearClashHold(ticketId) {
  if (ticketId) CLASH_HOLDS.delete(String(ticketId));
}

/** D9: Start now's refusal: the hold's reason only when the hold arm ran for this request (the ticket is back to
 *  scheduled and unforced, and the hold was found at or after `requestAt`). Pure. → string | null */
export function clashRefusalOf({ ticket, hold, requestAt }) {
  if (!ticket || !hold || ticket.status !== 'scheduled' || ticket.forced) return null;
  return hold.at >= requestAt ? hold.reason : null;
}

/** D4: the work branch of each run slice `index` builds on directly (its `dependsOn` rows), from previousBranchesOf.
 *  A row with no single-project branch is left out; any still merging back makes the answer pending. A follow-up
 *  slice, an unknown feature or index, or an error → no branches. Never throws.
 *  → {pending:true} | {branches: Array<{index, pipelineId, branch}>} */
export function dependencyBranchesOf(featureId, index, { now = Date.now() } = {}) {
  try {
    const f = featureId ? featureRow(featureId) : null;
    const s = f ? f.outline.slices[index - 1] : null;
    if (!s) return { branches: [] };
    const rows = sliceRows(f.id);
    const mine = rows.find((r) => r.index === index);
    if (!mine || mine.kind === 'follow-up') return { branches: [] };
    const bySlice = new Map(rows.map((r) => [r.sliceId, r]));
    const deps = (Array.isArray(s.dependsOn) ? s.dependsOn : []).map((id) => bySlice.get(id)).filter((r) => r && r.index !== index);
    const branches = [];
    for (const d of deps) {
      if (!d.pipelineId) continue;
      const prev = previousBranchesOf(d.pipelineId, { now });
      if (prev && prev.pending) return { pending: true };
      if (prev && prev.sourceBranch) branches.push({ index: d.index, pipelineId: d.pipelineId, branch: prev.sourceBranch });
    }
    return { branches };
  } catch { return { branches: [] }; }
}

/** The slice a ticket fires (the one ticket lookup): its feature, index, the feature's status and its "Ask me before
 *  each run" switch. null for a ticket no slice row points at. */
export function sliceOfTicket(ticketId) {
  if (!ticketId) return null;
  const r = getDb().prepare(`SELECT s.feature_id, s.idx, f.status, f.approve_each FROM shape_feature_slices s JOIN shape_features f ON f.id = s.feature_id
    WHERE s.ticket_id = ? LIMIT 1`).get(String(ticketId));
  return r ? { featureId: r.feature_id, index: r.idx, status: r.status, approveEach: r.approve_each === 1 } : null;
}

/** D3: the one display rule — a slice ticket the hold keeps from firing now that the run before it finished.
 *  Derived per read; the ticket's stored status stays `scheduled`. Shaper small runs: the slice gate decides instead
 *  of the linear predecessor, so a held slice behind a halted one still reads held. */
export function ticketHeld(ticket) {
  if (!ticket || ticket.status !== 'scheduled' || ticket.forced || !ticket.after) return false;
  if (!featureHoldsTicket(ticket)) return false;
  if (shaperSmallRunsOn()) return sliceGateState(ticket)?.state === 'ok';
  try { return predecessorState(ticket.after, { policy: ticket.after.policy }).state === 'ok'; } catch { return false; }
}

export function setApproveEach(id, on, { now = Date.now() } = {}) {
  return getDb().prepare('UPDATE shape_features SET approve_each = ?, updated_at = ? WHERE id = ?').run(on ? 1 : 0, iso(now), String(id)).changes > 0;
}

/** Shaper requirements s3 (D7): the acceptance ledger replaces `outline.acceptance` (entries already normalised). */
export function setFeatureAcceptance(featureId, entries, { now = Date.now() } = {}) {
  const f = featureRow(featureId);
  if (!f) return false;
  return getDb().prepare('UPDATE shape_features SET outline = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify({ ...f.outline, acceptance: entries }), iso(now), f.id).changes > 0;
}

/** The ledger on the ship block (D11): nothing pre-marked; a row the code review covered says so in its detail.
 *  `agreed`, `entries` and `covered` let the ship card repaint its rows as the person marks them. */
function shipAcceptance(f, slices) {
  const covered = [...new Set(slices.flatMap((s) => (s.requirements?.check?.items || []).filter((i) => i.pass).map((i) => i.id)))];
  const { items } = ledgerCheck(f.outline.agreed, f.outline.acceptance, covered);
  const { ready, marked, total } = acceptanceGate(f.outline.agreed, f.outline.acceptance);
  const agreed = f.outline.agreed.map(({ id, text }) => ({ id, text }));
  return { items, ready, marked, total, agreed, entries: Array.isArray(f.outline.acceptance) ? f.outline.acceptance : [], covered };
}

/** The ship gate's refusal body (D8) while an agreed requirement is unmarked, else null. Feature D1 (D7): a marked
 *  feature's gate reads `ship.smallRuns`: only the requirements a person confirms must be marked, and (fail closed)
 *  every other one must have a run; one that has neither names no role. */
export function acceptanceRefusal(view) {
  const sr = view?.ship?.smallRuns;
  if (sr) {
    if (!sr.blocked) return null;
    const unowned = sr.unowned || [];
    return { error: sr.reason, code: 'ACCEPTANCE_INCOMPLETE', missing: [...sr.waiting, ...unowned],
      role: unowned.length ? null : sr.confirmed.find((c) => c.state === 'waiting')?.role || null };
  }
  const ledger = view?.ship?.acceptance;
  if (!ledger || ledger.ready) return null;
  const missing = ledger.items.filter((i) => !i.pass).map((i) => i.id);
  return { error: `mark every requirement before you create the PR (${missing.length} left)`, code: 'ACCEPTANCE_INCOMPLETE', missing };
}

/** Feature D1 (D10, D11): a marked feature's Ship: the requirement rows, the block reason and the Care outcome
 *  (ship-ledger.mjs), the root source's name and the runs in finish order with their PR and what each stacks on. */
function smallRunsShip(f, slices, verify) {
  // Small runs D3 (D3): with the flag on, every row carries its status (`shown`), computed here once from the runs' states
  // and the runs that build an id again; with the flag off the ledger is D1's, byte for byte.
  const ledger = ledgerOf(f, verify, shaperSmallRunsOn()
    ? { runs: slices.map((s) => ({ index: s.index, state: s.state, stop: s.stop || null })), reruns: rerunsOf(f.outline) } : {});
  const root = featureRootSource(f.id);
  const chain = shipChainOf(f.id);
  const list = orderOf(f.id, slices, chain);
  const order = list.map((s, i) => {
    const base = i > 0 && s.pipelineId ? (chain ? chainBaseOf(chain, s.pipelineId) : smallRunsPrBase(s.pipelineId)) : null;
    const prev = list[i - 1];
    return { index: s.index, pipelineId: s.pipelineId, title: s.title,
      pr: s.pr && s.pr.url ? { number: s.pr.number ?? null, url: s.pr.url } : null,
      onto: base && base !== root && prev && prev.pr && prev.pr.url ? (prev.pr.number ?? null) : null };
  });
  return { ...ledger, care: careOutcome(careOfRow(f), featureFigures(f.id), ledger.met), base: baseName(f.project_dir, root), order,
    ...(chain ? { along: true } : {}) };
}

/** The root source as the PR names it: `origin/dev` reads `dev` when `origin` is one of the project's remotes (git-info.mjs
 *  prBaseBranch maps it so for the PR). The remote names are read once per project and kept for a minute. */
const REMOTES = new Map();
function baseName(projectDir, root) {
  if (!projectDir || typeof root !== 'string' || !root.includes('/')) return root;
  let hit = REMOTES.get(projectDir);
  if (!hit || Date.now() - hit.at > 60_000) {
    let names = [];
    try { names = execFileSync('git', ['remote'], { cwd: projectDir, env: guardedGitEnvSync(projectDir), encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/).map((x) => x.trim()).filter(Boolean); } catch { names = []; }
    REMOTES.set(projectDir, (hit = { at: Date.now(), names }));
  }
  const remote = [...hit.names].sort((a, b) => b.length - a.length).find((n) => root.startsWith(`${n}/`) && root.length > n.length + 1);
  return remote ? root.slice(remote.length + 1) : root;
}

/** The ship ledger of feature row `f` (ship-ledger.mjs), with `verify` the Verifier's view or null. */
const ledgerOf = (f, verify, status = {}) => shipLedger({ agreed: f.outline.agreed || [], kinds: requirementKindsOf(j(f.requirement_kinds, null), f.outline),
  acceptance: f.outline.acceptance, verify, ...status });

/** Fail closed, for the Runs list: why a feature is not ready to ship although its runs are done (an agreed requirement
 *  has no run and no person), from its row alone; null when none. The caller checks the flag and the marker. */
export function shipHold(featureId) {
  const f = featureRow(featureId);
  return f ? unownedReason(requirementKindsOf(j(f.requirement_kinds, null), f.outline).filter((k) => k.kind === 'owned' && k.run === null).map((k) => k.id)) : null;
}

/** A feature's recorded figures (shape_feature_figures, one row), or null. Readable with the flag off; measure.mjs
 *  re-exports it. */
export function featureFigures(featureId) {
  const row = getDb().prepare('SELECT figures FROM shape_feature_figures WHERE feature_id = ?').get(String(featureId));
  return row ? j(row.figures, null) : null;
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
function sliceState(row, live, { held = true } = {}) {
  if (!row.pipelineId) return row.ticket ? (held && ticketHeld(row.ticket) ? 'held' : TICKET_STATE[row.ticket.status] || 'planned') : 'planned';
  const l = live(row.pipelineId);
  // Slice 5 (D3): the bare "being resumed" overlay (no runs-map entry yet) reads the row's stored state.
  if (l && !(l.resuming && l.runId === null)) return l.waiting ? 'approval' : l.asking ? 'questions' : l.status === 'paused' ? 'paused' : l.approved ? 'running' : 'shaping';
  const p = getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get(row.pipelineId);
  return (p && PIPELINE_STATE[p.status]) || 'starting';
}

/** L8: the runs-map entry as featureView's `live` reads it (ui/server.mjs liveSliceOf). `waiting` is a pending plan
 *  ask, `asking` any other pending ask; `ask` names it for the feature card's open step (s2, D9). */
export function liveSliceFrom({ runId, status, pendingQuestion = null, approved = false, heldStop = null, refused = null, going = false }) {
  const pq = pendingQuestion || null;
  const plan = !!pq && pq.kind === PLAN_ASK_KIND;
  // Small runs C3 (D8): a marked run's open stop question, and whether its answer is held for another run's turn.
  // Slice 3 (D11, D13): why a held answer was not sent (`refused`), and a take-in in flight (`going`).
  const value = heldStop ? stopOptionOf(pq && pq.stop, heldStop.payload)?.value : null;
  const stop = pq && pq.stop ? { reason: pq.stop.reason, held: !!heldStop,
    ...(heldStop && Number.isInteger(heldStop.after) ? { after: heldStop.after } : {}), ...(value ? { value } : {}),
    ...(refused ? { refused } : {}), ...(going ? { going: true } : {}) } : null;
  return { runId, status: String(status || ''), waiting: plan, asking: !!pq && !plan, approved: !!approved,
    ask: pq ? { id: pq.id || null, kind: plan && pq.plan && pq.plan.outline ? 'outline' : pq.kind } : null, ...(stop ? { stop } : {}) };
}

/** Slice 5 (D1): the overlay of a run being resumed at server start that has no usable runs-map entry yet. */
export function liveSliceResuming() {
  return Object.freeze({ ...liveSliceFrom({ runId: null, status: 'paused' }), resuming: true });
}

const auditTexts = (pid) => (pid ? getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ? ORDER BY id').all(String(pid)).map((r) => r.text) : []);
function clarifyOf(pid) {
  const r = readClarifyRow(pid);
  return { questions: Array.isArray(r.questions?.questions) ? r.questions.questions : [], answers: Array.isArray(r.answers?.answers) ? r.answers.answers : [] };
}
/** D7: the feature card's step log, from the origin run's clarify row and audit lines, each later run's audit lines,
 *  and (while re-planning) every run after the last done one: replanBrief re-plans the halted run with the canceled.
 *  `oneCard` (B1, D7): the one card's receipt words; the feature page keeps dev's. */
function featureLog(f, slices, oneCard = false, changes = [], verify = null) {
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
    oneCard, changes,
    // Small runs C5 (D13): the Verifier's receipts, after the changes.
    ...(verify ? { verify } : {}),
  });
}

/** A slice's agreed ids and their check against its last code review (null before one ran). */
function sliceRequirements(f, r) {
  const ids = f.outline.slices[r.index - 1]?.requirements || [];
  const last = r.pipelineId ? readPipelineExtras(r.pipelineId).reviews.filter((v) => v.kind === 'impl').sort((a, b) => a.cycle - b.cycle).at(-1) : null;
  const texts = Object.fromEntries(f.outline.agreed.map((a) => [a.id, a.text]));
  return { ids, check: last ? requirementsCheck(ids, texts, last.issues) : null };
}

export function featureView(id, { live = () => null, finishing = () => false, oneCard = false } = {}) {
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
      watch: pr && pr.url ? stoppedWatchFact(getWatch(pr.url)) : null,
      ...(f.outline.agreed?.length ? { requirements: sliceRequirements(f, r) } : {}) };
  });
  if (smallRunsOfFeature(f.id)) stopWords(f, rows, slices, live);
  // Slice 6 (D1, D5): with the flag on, an active marked feature lists every open stop and failed run; the first is `ask`.
  const asks = shaperSmallRunsOn() && smallRunsOfFeature(f.id) && f.status === 'active' ? openStopsOf(rows, slices, live) : null;
  if (asks && asks.length) ask = asks[0];
  const roundLive = slices.some((s) => s.rounds.some((x) => LIVE_ROUND.has(x.status)));
  const ideas = getDb().prepare(`SELECT COUNT(*) AS n FROM shape_feature_notes WHERE feature_id = ? AND kind = 'idea'
    AND (run_index IS NULL OR run_index NOT IN (SELECT idx FROM shape_feature_slices WHERE feature_id = ? AND pipeline_id IS NOT NULL))`).get(f.id, f.id).n;
  const done = slices.filter((s) => s.state === 'done').length;
  const h = slices.find((s, i) => HALTS.has(s.state) || (i > 0 && STUCK.has(s.state) && slices[i - 1].state === 'done'));
  const waiting = h ? slices.filter((s) => s.index > h.index && (s.state === 'planned' || s.state === 'missed')).map((s) => s.index) : [];
  // D3: the run that waits for the owner's Start now ("Ask me before each run"); never persisted.
  const held = slices.find((s) => s.state === 'held') || null;
  const clash = held ? clashHoldOf(held.ticketId) : null;
  // D24: Ship as once every slice is done, on a feature that is still active and not shipped. The suggestion is
  // async (featureShipSuggestion); the GET route merges it.
  const lastPrUrl = slices.length ? (slices[slices.length - 1].pr?.url || null) : null;
  // A ship whose PRs were all closed unmerged is withdrawn: the feature ships again (the ship route clears the record).
  const shipPrs = slices.map((s) => s.pr).filter((p) => p && p.url);
  const shipped = !!f.ship_mode && !(shipPrs.length && shipPrs.every((p) => p.state === 'CLOSED'));
  // Small runs C5 (D11): a feature with a Verifier check ships only once the latest check is clean or accepted.
  const verify = verifyView(f, live, slices, finishing, shipped);
  // With the flag on, a halted Verifier waits for Resume, so its feature is not done: the card's controls are for an active one.
  const status = f.status === 'active' && done === slices.length && !(verify && verify.state === 'halted' && shaperSmallRunsOn()) ? 'done' : f.status;
  // The ship rule (verifier.mjs checkedHead): with the flag on, a marked feature needs a passed check for the head it ships
  // (a check for another head does not read clean or accepted) and nothing of it finishing, interrupted or pending.
  const ruled = shipRuleOn(f);
  const verified = verify ? verify.state === 'clean' || verify.state === 'accepted' : !ruled;
  const settling = ruled && (stillFinishing(slices, finishing) || roundOpen(slices));
  const release = shipped && f.release_version ? { version: f.release_version, url: f.release_url || null, error: f.release_error || null } : null;
  const sr = smallRunsOfFeature(f.id) ? smallRunsShip(f, slices, verify) : null;
  const ship = { ready: slices.length > 0 && done === slices.length && f.status === 'active' && !shipped && !roundLive && verified && !settling
      // Fail closed: an agreed requirement with no run and no person (a missing mark blocks through the ledger instead).
      && !(sr && sr.unowned),
    mode: shipped ? f.ship_mode : null, prUrl: shipped ? f.ship_pr_url || null : null, lastPrUrl, suggested: null, linesAdded: null,
    linesRemoved: null, files: null, release,
    // s4: what the applied Ship card shows, wherever it renders (chat, group page, Plans).
    result: shipped ? { mode: f.ship_mode, prUrl: f.ship_pr_url || lastPrUrl,
      closed: f.ship_mode === 'one' ? (f.ship_closed ?? slices.filter((s) => s.pr && s.pr.state === 'CLOSED').length) : 0, release } : null,
    ...(f.outline.agreed?.length ? { acceptance: shipAcceptance(f, slices) } : {}),
    // Feature D1 (D10): a marked feature's Ship model, last; an unmarked feature keeps dev's keys.
    ...(sr ? { smallRuns: sr } : {}) };
  // The Re-plan the rest run (replanning/replanned): its ticket id is the run id it fires as (ui/server.mjs:2188).
  const rt = f.replan_ticket_id ? getTicket(f.replan_ticket_id) : null;
  const replan = rt ? { ticketId: rt.id, pipelineId: rt.pipelineId || null, runId: rt.pipelineId ? (live(rt.pipelineId)?.runId || null) : null } : null;
  // s3 (D16): while re-planning, no slice asks; the Re-plan the rest run's Split ask is the card's open step.
  if (!ask && f.status === 'replanning' && replan && replan.pipelineId) {
    const l = live(replan.pipelineId);
    if (l && l.ask) ask = { index: null, runId: l.runId || null, pipelineId: replan.pipelineId, id: l.ask.id, kind: l.ask.kind };
  }
  // Small runs C5: the live Verifier run's question (its bound stop) is the card's open step, like the Re-plan ask.
  if (!ask && verify && verify.pipelineId) {
    const l = live(verify.pipelineId);
    if (l && l.ask) ask = { index: null, runId: l.runId || null, pipelineId: verify.pipelineId, id: l.ask.id, kind: l.ask.kind };
  }
  const ch = changeKeys(f, slices);
  return {
    id: f.id, title: f.title, projectKey: projectKey(f.project_dir),   // a History link needs it (F28)
    status, approveEach: f.approve_each !== 0, total: slices.length, done,
    halted: h ? { index: h.index, state: h.state, waiting } : null,
    open: slices.some((s) => ['planned', 'missed', 'held'].includes(s.state)),
    held: held ? { index: held.index, ticketId: held.ticketId, ...(clash ? { reason: clash.reason } : {}) } : null,
    replacedBy: f.replaced_by || null, replan, slices, ship,
    originPipelineId: f.origin_pipeline_id, ask, ...(asks ? { asks } : {}), log: featureLog(f, slices, oneCard, ch.logged, f.outline.verify || null), notes: { ideas },
    // Shaper small runs A2: the record's 2 keys, last, only with the flag on or (B2, D20) for a marked feature; an unmarked
    // feature with the flag off is dev's exact shape.
    ...(shaperSmallRunsOn() || smallRunsOfFeature(f.id) ? { care: careOfRow(f), requirementKinds: requirementKindsOf(j(f.requirement_kinds, null), f.outline) } : {}),
    // C1 (D12): a marked feature's Prototype step, read from its origin run; absent without a record.
    ...protoKey(smallRunsOfFeature(f.id) ? prototypeOfPipeline(f.origin_pipeline_id) : null),
    // Small runs C4 (D17): the change on the notice and every change entry; absent before the first change.
    ...(ch.changes.length ? { change: ch.change, changes: ch.changes } : {}),
    // Small runs C5 (D12): the latest Verifier check as the card reads it; absent before the first check.
    ...(verify ? { verify } : {}),
  };
}

const FAILED_RUN = new Set(['error', 'failed']);   // run-status.mjs FAILED: the red "!"

/** Slice 6 (D2 to D4, D6): a marked feature's open stops (a live ask whose answer is not held) and failed runs, in run
 *  order, each with the unfinished runs it holds up. `stopWords` has already set `buildsOn` on every slice. */
function openStopsOf(rows, slices, live) {
  const byRun = new Map(slices.map((s) => [s.index, s]));
  const out = [];
  rows.forEach((r, i) => {
    const s = slices[i];
    const l = r.pipelineId ? live(r.pipelineId) : null;
    if (l && l.ask && !(l.stop && l.stop.held)) {
      out.push({ index: r.index, runId: l.runId || null, pipelineId: r.pipelineId, id: l.ask.id, kind: l.ask.kind,
        reason: (l.stop && l.stop.reason) || null, failed: false, holdsUp: holdsUpOf(r.index, byRun) });
    } else if (FAILED_RUN.has(s.state)) {
      out.push({ index: r.index, runId: null, pipelineId: r.pipelineId, id: null, kind: null, reason: null, failed: true,
        holdsUp: holdsUpOf(r.index, byRun) });
    }
  });
  return out.sort((a, b) => a.index - b.index);
}

/** Small runs C3 (D15): a marked feature's slices gain `stop` (an open or held stop question) and `waitsFor`. With the
 *  flag off, `waitsFor` is a run not started yet that builds on a stopped run: that run's number, named from `dependsOn`.
 *  With the flag on (slice 2 D4 to D8), every not-started run (`planned` or `held`) gets `waitsFor`, the sorted runs the
 *  gate holds it on (sliceHolds), `cannotStart` {run, reason} when a run it builds on can never finish, and the one
 *  run that goes on next carries `nextTurn: true` (nextTurnOf): a started run whose stop answer is held waiting its
 *  turn (owner direction dd8aea6ed), else the run the scheduler starts next. */
function stopWords(f, rows, slices, live) {
  const bySlice = new Map(rows.map((r, i) => [r.sliceId, slices[i]]));
  for (const s of slices) {
    const l = s.pipelineId ? live(s.pipelineId) : null;
    if (l && l.stop) s.stop = { ...l.stop };
  }
  if (shaperSmallRunsOn()) {
    const holdsByIndex = new Map();
    const rowBySlice = new Map(rows.map((r) => [r.sliceId, r]));
    // Slice 3 (D2): every slice's direct builds-on runs, started ones too (run-status.mjs namedWaits reduces by them).
    rows.forEach((r, i) => {
      const deps = (f.outline.slices[slices[i].index - 1]?.dependsOn || []).map((id) => rowBySlice.get(id));
      slices[i].buildsOn = deps.filter((d) => d && d.index !== r.index).map((d) => d.index).sort((a, b) => a - b);
    });
    rows.forEach((r, i) => {
      const s = slices[i];
      if (s.pipelineId || !NOT_STARTED_STATE.has(s.state)) return;
      const holds = sliceHolds(f, rows, r.index, { isLive: null, bySlice: rowBySlice });
      holdsByIndex.set(r.index, holds);
      s.waitsFor = holds.waitsFor;
      if (holds.bad) s.cannotStart = { run: holds.bad.run, reason: holds.bad.reason };
    });
    const next = nextTurnOf(f, rows, holdsByIndex, (r, i) => !!(slices[i].pipelineId && slices[i].stop && slices[i].stop.held));
    if (next) slices[rows.indexOf(next)].nextTurn = true;
    return;
  }
  for (const s of slices) {
    if (s.pipelineId) continue;
    const dep = (f.outline.slices[s.index - 1]?.dependsOn || []).map((id) => bySlice.get(id)).find((d) => d && d.stop);
    if (dep) s.waitsFor = dep.index;
  }
}

/** Small runs: what each slice's one short word reads (run-agents.mjs cardShortWord), from the rows alone (no full view):
 *  index → {kind, state, stop?, waitsFor?, cannotStart?, nextTurn?, buildsOn?}, the words featureView's slices carry. */
export function sliceWords(featureId, { live = () => null } = {}) {
  const f = featureRow(featureId);
  if (!f) return new Map();
  const rows = sliceRows(f.id);
  const slices = rows.map((r) => ({ index: r.index, pipelineId: r.pipelineId, kind: r.kind, state: sliceState(r, live) }));
  stopWords(f, rows, slices, live);
  return new Map(slices.map(({ index, pipelineId, ...s }) => [index, s]));
}

/** D17: `change` is the newest entry whose landing run (the change run, else the owner) is not done; `changes` every
 *  entry. The log gets every entry but `change`, so one change never shows twice. A feature with no entry keeps its
 *  shape (no keys). */
function changeKeys(f, slices) {
  const all = Array.isArray(f.outline.changes) ? f.outline.changes : [];
  const landing = (e) => slices[(e.case === 'finished' ? e.added : e.run) - 1];
  const change = [...all].reverse().find((e) => e.case !== 'none' && landing(e) && landing(e).state !== 'done') || null;
  return { change, changes: all, logged: all.filter((e) => e !== change) };
}

const protoKey = (rec) => { const v = rec ? prototypeView(rec) : null; return v ? { prototype: v } : {}; };

export const ONE_PR_MAX_LINES = 1500;

const NOT_STARTED = new Set(['planned', 'missed']);
// Slice 2 (D7): the slice states of a run not started that gets waitsFor, cannotStart and nextTurn.
const NOT_STARTED_STATE = new Set(['planned', 'held']);
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

const APPEND_KINDS = new Set(['extra', 'follow-up', 'change']);

/** Shaper s5 (D13): run N+1 of the feature. 'extra' chains after the last run; 'follow-up' fires now from the base.
 *  Small runs C4 (D6): 'change' chains like 'extra' and owns the changed `requirements`. Throws SHIPPING while the Ship lock holds. */
export function appendFeatureRun(featureId, { title, goal, kind, by = null, requirementsFirst = false, requirements = null, now = Date.now() }) {
  if (!APPEND_KINDS.has(kind)) throw new TypeError('kind must be extra, follow-up or change');
  const f = featureRow(featureId);
  if (!f) return null;
  let out = null;
  tx(() => { refuseWhileShipping(f.id); out = appendRunRows(f, sliceRows(featureId), { title, goal, kind, by, requirementsFirst, requirements, now }); });
  return out;
}

/** The tx-free body of appendFeatureRun (D6): the slice, its ticket, the grown outline and the held notes. `f` must be
 *  the fresh row: the outline written is `f.outline` plus the new slice. */
function appendRunRows(f, rows, { title, goal, kind, by = null, requirementsFirst = false, requirements = null, now = Date.now() }) {
  const db = getDb();
  const index = rows.length + 1;
  const last = rows[rows.length - 1];
  const s = { id: `s${index}`, title: String(title).slice(0, 120), goal: String(goal || ''), inScope: [], outOfScope: [],
    acceptance: [], dependsOn: [], estimate: null, ...(kind === 'change' && Array.isArray(requirements) ? { requirements: [...requirements] } : {}) };
  const outline = { ...f.outline, slices: [...f.outline.slices, s] };
  const feature = { id: f.id, title: f.title };
  const chained = kind !== 'follow-up';
  const after = last.pipelineId ? { kind: 'pipeline', id: last.pipelineId } : { kind: 'ticket', id: last.ticketId };
  const t = createTicket({
    title: sliceTitle(f.title, index, index, s), projectDir: f.project_dir,
    request: { ...sliceRequest({ feature, index, outline, perspectives: f.perspectives, workflowId: f.workflow_id, base: f.base,
      projectDir: f.project_dir, startedBy: by, sourceBranch: kind === 'follow-up' ? f.source_branch : null,
      requirementsFirst: kind === 'follow-up' && requirementsFirst === true }),
    ...(kind === 'follow-up' ? originCarry(f) : {}) },   // s2: a chained `extra` inherits at fire instead
    ...(chained ? { after, afterPolicy: 'done', sourceFromPrevious: true } : { runAtMs: now }),
    createdBy: by, now,
  });
  db.prepare('INSERT INTO shape_feature_slices (feature_id, idx, slice_id, title, ticket_id, pipeline_id, kind) VALUES (?, ?, ?, ?, ?, NULL, ?)')
    .run(f.id, index, s.id, s.title, t.id, kind);
  db.prepare("UPDATE shape_features SET outline = ?, status = 'active', updated_at = ? WHERE id = ?").run(JSON.stringify(outline), iso(now), f.id);
  db.prepare('UPDATE shape_feature_notes SET run_index = ? WHERE feature_id = ? AND run_index IS NULL').run(index, f.id);
  return { index, ticketId: t.id };
}

/** Small runs C4 (D2): a not-started slice's ticket again, its request carrying `outline` (the changed text). The old
 *  request keeps everything else (source branch, tags, starter); the timing, hold and chain are copied. The caller
 *  re-points the slice row and cancels the old ticket last. → the new ticket id */
function reissueTicket(f, row, outline, { by = null, now = Date.now() } = {}) {
  const old = getTicket(row.ticketId, { withRequest: true });
  const req = old.request || {};
  const fresh = sliceRequest({ feature: { id: f.id, title: f.title }, index: row.index, outline, perspectives: f.perspectives,
    workflowId: f.workflow_id, base: f.base, projectDir: f.project_dir });
  const slice = req.shape && req.shape.slice ? { ...req.shape.slice, outline } : fresh.shape.slice;
  const request = { ...req, prompt: fresh.prompt, shape: { ...(req.shape || fresh.shape), slice } };
  const t = createTicket({
    title: old.title, projectDir: old.projectDir || f.project_dir, request, ifMissed: old.ifMissed, graceMin: old.graceMin, forced: old.forced,
    ...(old.after ? { after: { kind: old.after.kind, id: old.after.id }, afterPolicy: old.after.policy, sourceFromPrevious: old.sourceFromPrevious }
      : { runAtMs: Date.parse(old.runAt) }),
    createdBy: by, now,
  });
  getDb().prepare('UPDATE shape_feature_slices SET ticket_id = ? WHERE feature_id = ? AND idx = ?').run(t.id, f.id, row.index);
  return t.id;
}

const STALE_ERROR = (id) => Object.assign(new Error(`${id} changed since: read it again`), { code: 'STALE', status: 409 });

/**
 * Small runs C4 (D2–D6): the one mid-build writer of `outline.agreed`, in one tx. (1) each change's text, re-checking
 * `from` (STALE throws and rolls back), with (2) the `outline.changes` entries in the same UPDATE; then, on the fresh
 * row, (3) every not-started slice's ticket re-issued and a restart ticket for each `restart` index, (4) a change run
 * for each `appendFor`, (5) every open `after` ref to a replaced ticket re-chained, (6) the old tickets cancelled last.
 * `entries` are written as given (the caller fills `added`). → {entries, added:[{ownerIndex, index, ticketId}], restarted:[{index, ticketId}]}
 */
export function changeAgreedRequirements(featureId, opts) {
  let out = null;
  tx(() => { refuseWhileShipping(featureId); out = changeAgreedRequirementsIn(featureId, opts); });
  return out;
}

/** Small runs C5 (D5): changeAgreedRequirements' body with no tx of its own, for a caller that already holds one (the
 *  Verifier's check record and its gap runs commit together). tx() refuses nesting. */
export function changeAgreedRequirementsIn(featureId, { changes, entries = [], restart = [], appendFor = [], by = null, now = Date.now() }) {
  const db = getDb();
  const f0 = featureRow(featureId);
  const agreed = (f0.outline.agreed || []).map((a) => ({ ...a }));
  for (const c of changes) {
    const a = agreed.find((x) => x.id === c.id);
    if (!a || a.text !== c.from) throw STALE_ERROR(c.id);
    a.text = c.to;
  }
  const kept = [...(Array.isArray(f0.outline.changes) ? f0.outline.changes : []), ...entries].slice(-CHANGES_MAX);
  db.prepare('UPDATE shape_features SET outline = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify({ ...f0.outline, agreed, changes: kept }), iso(now), f0.id);
  let f = featureRow(featureId);
  const replaced = new Map();
  for (const r of sliceRows(featureId)) {
    if (r.pipelineId || !r.ticket || !['scheduled', 'missed'].includes(r.ticket.status)) continue;
    replaced.set(r.ticketId, reissueTicket(f, r, f.outline, { by, now }));
  }
  const restarted = [];
  for (const index of restart) {
    const r = restartRows(f, sliceRows(featureId), { index }, { by, now });
    if (r.error) throw Object.assign(new Error(r.error), { code: 'CANNOT_RESTART', status: r.status });
    restarted.push({ index, ticketId: r.ticketId });
  }
  const added = [];
  for (const a of appendFor) {
    const r = appendRunRows(f, sliceRows(featureId), { title: a.title, goal: a.goal, kind: 'change', requirements: a.ids, by, now });
    added.push({ ownerIndex: a.ownerIndex, index: r.index, ticketId: r.ticketId });
    f = featureRow(featureId);
  }
  for (const [oldId, newId] of replaced) {
    const refs = db.prepare("SELECT id FROM scheduled_runs WHERE after_kind = 'ticket' AND after_id = ? AND status IN ('scheduled', 'missed')").all(oldId);
    for (const { id } of refs) if (!replaced.has(id)) updateTicket(id, { after: { kind: 'ticket', id: newId } }, { now, by });
  }
  for (const oldId of replaced.keys()) cancelTicket(oldId, { by, now });
  return { entries, added, restarted };
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

/** Forget a withdrawn ship (every PR closed unmerged) so the next ship records afresh. false = nothing recorded. */
export function clearShip(id, { now = Date.now() } = {}) {
  return getDb().prepare(`UPDATE shape_features SET ship_mode = NULL, ship_pr_url = NULL, ship_closed = NULL, shipped_at = NULL,
      release_version = NULL, release_target = NULL, updated_at = ? WHERE id = ? AND ship_mode IS NOT NULL`)
    .run(iso(now), String(id))
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
  const inputOf = (s) => {
    const reviews = s.pipelineId ? readPipelineExtras(s.pipelineId).reviews : [];
    const last = reviews.filter((v) => v.kind === 'impl' && v.summary).sort((a, b) => a.cycle - b.cycle).at(-1);
    const cl = latestChecklist(reviews);
    return { index: s.index, title: s.title, pipelineId: s.pipelineId, pr: s.pr,
      summary: last ? last.summary.slice(0, 600) : '', checklistMd: cl ? checklistMarkdown(cl.checklist).trimEnd() : '',
      ...(s.requirements ? { requirements: s.requirements } : {}) };
  };
  const slices = shipOrder(view).map(inputOf);
  // Slice 4: a carried run gets no PR, but its work ships inside a listed run's PR, so the changelog names it.
  const ids = new Set((shipChainOf(view.id)?.carried || []).map((c) => c.pipelineId));
  const carried = view.slices.filter((s) => s.pipelineId && ids.has(s.pipelineId)).map(inputOf);
  return { id: view.id, title: view.title, slices, ...(carried.length ? { carried } : {}) };
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

/** The first feature of a Re-plan the rest chain (walks `replaces` back; bounded and cycle-safe): its `source_branch` is the
 *  branch the whole feature merges into, which a later re-plan run's own source (the last done slice's branch) is not. */
export function featureRootSource(featureId) {
  const q = getDb().prepare('SELECT source_branch, replaces FROM shape_features WHERE id = ?');
  const seen = new Set();
  let cur = String(featureId); let row = null;
  for (let i = 0; i < REPLAN_HOPS && !seen.has(cur); i++) {
    seen.add(cur);
    const r = q.get(cur);
    if (!r) break;
    row = r;
    if (!r.replaces) break;
    cur = r.replaces;
  }
  return row?.source_branch || null;
}

/** Shaper s2 (D10): what the Chat feature card reads for the run its thread started — the feature view (log and open
 *  ask included) once the outline is approved, else, for a run `shaped(pid)` names (its runs-map entry carries
 *  orch.state.shaping), the run's own decision log. null for an unknown run and for a plain one.
 *  Shaper small runs B1 (D1, D3): `smallRuns: true`, last, when the marker saved on the feature's origin run (before the
 *  split, on the run itself) is set, with the one card's log words; without it the answer is dev's exact shape. */
export function shaperCard(pipelineId, { live = () => null, finishing = () => false, shaped = () => false } = {}) {
  const pid = String(pipelineId);
  if (!getDb().prepare('SELECT 1 FROM pipelines WHERE id = ?').get(pid)) return null;
  const at = featureOfPipeline(pid);
  const fid = at ? currentFeatureId(at.featureId) : null;
  const featureMarked = !!fid && smallRunsOfFeature(fid);
  const feature = fid ? featureView(fid, { live, finishing, oneCard: featureMarked }) : null;
  if (!feature && !shaped(pid)) return null;
  const marked = feature ? featureMarked : smallRunsOfPipeline(pid);
  // B2 (D18): the Care saved at the Start step, for a marked run; absent until Start is answered.
  const care = marked ? careOfPipeline(feature ? feature.originPipelineId : pid) : null;
  return { pipelineId: pid, feature,
    log: feature ? feature.log : buildDecisionLog({ clarify: clarifyOf(pid), origin: auditTexts(pid), oneCard: marked }),
    ...(marked ? { smallRuns: true } : {}), ...(care ? { care } : {}),
    // C1 (D12): the Prototype step's state, for a marked card with a record.
    ...protoKey(marked ? prototypeOfPipeline(feature ? feature.originPipelineId : pid) : null) };
}

/** B1 (D8): whether Chat posts the feature's Ship card. A marked feature ships from its feature page until the one card
 *  draws Ship (Feature D). */
export function chatShipCardOffered(view) {
  return !smallRunsOfFeature(view && view.id);
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

/** D16, D22: where a run sits in its feature, or null. Shaper small runs D2 (D8): a marked feature with the flag on adds
 *  `owns` (always an array) and `startsFrom` (null when the run's row stores no source); otherwise dev's exact keys. */
export function sliceOfPipeline(pipelineId, { live = () => null } = {}) {
  const at = featureOfPipeline(pipelineId);
  if (!at) return null;
  const v = featureView(at.featureId, { live });
  if (!v) return null;
  const s = v.slices[at.idx - 1];
  const n = v.slices[at.idx] || null;
  return { featureId: v.id, title: v.title, index: at.idx, total: v.total, sliceTitle: s ? s.title : '',
    state: s ? s.state : null, next: n ? { index: n.index, title: n.title, state: n.state } : null, ...(s && s.stop ? { stop: s.stop } : {}),
    ...(shaperSmallRunsOn() && smallRunsOfFeature(v.id) ? runFacts(v, at.idx, s) : {}) };
}

const branchOf = (pid) => (pid ? j(getDb().prepare('SELECT branch FROM pipelines WHERE id = ?').get(String(pid))?.branch, null) : null);

/** D2 (D7, D8): a run's Owns rows (from the `requirements` featureView already put on the slice, with the agreed texts)
 *  and where it starts from (its stored `branch.source` against the feature base and the earlier runs' branches). */
function runFacts(v, index, s) {
  const req = (s && s.requirements) || { ids: [], check: null };
  const f = featureRow(v.id);
  const agreed = f?.outline?.agreed;
  const texts = Object.fromEntries((Array.isArray(agreed) ? agreed : []).map((a) => [a.id, a.text]));
  const runs = v.slices.filter((x) => x.index < index && x.pipelineId).map((x) => ({ index: x.index, feature: branchOf(x.pipelineId)?.feature || null }));
  const source = s && s.pipelineId ? branchOf(s.pipelineId)?.source || null : null;
  // D3 (D4): the Owns rows' words are the feature's own `shown` (computed once in shipLedger), never a second ledger.
  const sr = v.ship && v.ship.smallRuns;
  const shown = new Map((sr ? [...sr.owned, ...sr.confirmed] : []).filter((e) => e.shown).map((e) => [e.id, e.shown]));
  // Slice 11 (D4 to D7): what the run waits for (the gate's own rule, reduced as R-po-1) and which runs build on it,
  // nested under `links` so no top-level `waitsFor` reads as a slice's wait word (run-stops.mjs runStopWord).
  const bySlice = new Map(v.slices.map((x) => [x.index, x]));
  const holds = f ? sliceHolds(f, sliceRows(v.id), index) : { waitsFor: [] };
  const links = { waitsFor: namedWaits({ waitsFor: holds.waitsFor }, bySlice), neededBy: neededByOf(index, bySlice) };
  return { owns: ownsOf({ ids: req.ids, texts, check: req.check, shown }), startsFrom: startsFromOf({ index, source, base: featureBase(v.id), runs }), links };
}

const AGENT_TEST_NODES = Object.freeze(['n_impl', 'n_check']);
const isCount = (x) => Number.isSafeInteger(x) && x >= 0;
const testsOf = (meta) => {
  const t = meta && typeof meta === 'object' ? meta.tests : null;
  return t && typeof t === 'object' && isCount(t.passed) && isCount(t.total) && t.total >= 1 && t.passed <= t.total
    ? { passed: t.passed, total: t.total } : null;
};

/** D2 (D14): what the Agents rows' detail reads, from existing records only (it writes nothing): the highest plan
 *  version among the run's plan artifacts, whether a plan review (n_roles) finished, and the last valid stored test
 *  count (`exec_meta.tests`) of an n_impl or n_check step. Each part null/false when absent. */
export async function storedAgentFacts(pipelineId) {
  const plans = await listRunArtifacts(pipelineId, { kind: 'plan' });
  const planVersion = plans.length ? Math.max(...plans.map((a) => planVersionOf(a.relPath))) : null;
  const db = getDb();
  const planReviewed = !!db.prepare("SELECT 1 FROM pipeline_steps WHERE pipeline_id = ? AND node_id = 'n_roles' AND status = 'done' LIMIT 1")
    .get(String(pipelineId));
  const rows = db.prepare(`SELECT exec_meta FROM pipeline_steps WHERE pipeline_id = ? AND node_id IN (${AGENT_TEST_NODES.map(() => '?').join(', ')})
    AND exec_meta IS NOT NULL ORDER BY rowid`).all(String(pipelineId), ...AGENT_TEST_NODES);
  const tests = rows.map((r) => testsOf(j(r.exec_meta, null))).filter(Boolean).at(-1) || null;
  return { planVersion, planReviewed, tests };
}

/** One line: a title in a PR body is data, so its line breaks and runs of whitespace collapse to one space. */
const oneLine = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();

/** D22: the first lines of a slice's PR body: which feature, which slice, and the other slices' PRs. Feature D1 (D13): a
 *  marked feature's adds its Care line under `Satisfies:` and puts every title on one line. */
export function slicePrPreamble(pipelineId) {
  const at = featureOfPipeline(pipelineId);
  if (!at) return '';
  const f = featureRow(at.featureId);
  if (!f) return '';
  const marked = smallRunsOfFeature(f.id);
  const t = marked ? oneLine : (x) => x;
  const rows = sliceRows(f.id);
  const others = rows.filter((r) => r.index !== at.idx).map((r) => {
    const pr = r.pipelineId ? readPrState(r.pipelineId) : null;
    return `- Slice ${r.index}, ${t(r.title)}: ${pr?.url || 'not opened yet'}`;
  });
  const ids = f.outline?.slices?.[at.idx - 1]?.requirements || [];
  const care = marked ? `${carePrLines(f)}\n` : '';
  return `Part of ${t(f.title)}: slice ${at.idx} of ${rows.length}\n${ids.length ? `Satisfies: ${ids.join(', ')}\n` : ''}${care}\n${others.join('\n')}`;
}

/** A line of a slice PR's preamble that sits under "Part of" (the agreed ids, the Care line and the Not met / Dropped
 *  lines carePrLines adds): refreshSliceBody skips these before it swaps in the fresh preamble. */
export const isSlicePreambleLine = (line) => /^(Satisfies|Care|Not met|Dropped): /.test(String(line || ''));

/** A marked feature's `Care: …` PR line, from the live ledger and the recorded figures (careOutcome), then one line per
 *  requirement marked Not met or Dropped, with its reason (owner direction da6198d8d). */
function carePrLines(f) {
  const ledger = ledgerOf(f, verifyView(f));
  return [careOutcome(careOfRow(f), featureFigures(f.id), ledger.met).line, ...unmetLines(ledger).map(oneLine)].join('\n');
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
  for (const r of sliceRows(featureId)) {
    if (r.ticket && ['scheduled', 'missed'].includes(r.ticket.status) && cancelTicket(r.ticketId, { by, now })) { clearClashHold(r.ticketId); n += 1; }
  }
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

/** Resume slice k (L9), or a halted Verifier (C5: a new check ticket). Paused/interrupted → the caller resumes the pipeline, then calls rechainWaiting.
 *  Stopped/error/failed, or missed/canceled behind a done slice (F43) → a new ticket for slice k, re-chained so the
 *  waiting slices follow it.
 *  @returns {null|{error, status}|{action:'resume', pipelineId, index}|{action:'restart', ticketId}|{action:'none'}} */
export function resumeFeature(id, { live = () => null, finishing = () => false, by = null, now = Date.now(), index = null } = {}) {
  const f = featureRow(id);
  if (!f) return null;
  const refused = notActive(f);
  if (refused) return refused;
  const view = featureView(id, { live, finishing });
  // Slice 6 (D12): a stop line's Resume names its run; a run that is not halted is refused and nothing is written.
  if (index != null) {
    const named = view.slices[index - 1];
    if (!named || !HALTS.has(named.state)) return { status: 409, code: 'NOT_HALTED', error: `Run ${index} is not stopped` };
    return resumeHalted(f, id, named, { live, by, now });
  }
  // Small runs C5: every run done and the Verifier halted (failed, stopped, or settled with the flag off) → a fresh check,
  // with the flag on only (startVerifyCheck starts none without it).
  if (!view.halted && view.verify && view.verify.state === 'halted') {
    const v = startVerifyCheck(id, { by, now, finishing });
    return v ? { action: 'restart', ticketId: v.ticketId } : { action: 'none' };
  }
  if (!view.halted) return { action: 'none' };
  return resumeHalted(f, id, view.slices[view.halted.index - 1], { live, by, now });
}

/** resumeFeature's body for one halted run `h`: the busy check, a paused resume, or a restart. */
function resumeHalted(f, id, h, { live, by, now }) {
  // Shaper small runs (D10): one slice of a feature is going at a time; a refusal changes nothing.
  const smallRuns = shaperSmallRunsOn();
  const busy = smallRuns ? busySliceOf(id, { exclude: h.index, live }) : null;
  if (busy) return { status: 409, error: `Slice ${busy.index} is still going: resume this one when it finishes` };
  // The route resumes it like /api/resume, in the run's own mock mode, then calls rechainWaiting (F30). Small runs C4
  // (D8): a paused slice whose requirement changed since it started restarts instead, so it never resumes the old text.
  if (h.state === 'paused' && !changedSinceStart(f, h)) return { action: 'resume', pipelineId: h.pipelineId, index: h.index, mock: f.base.mock === true };
  let r = null;
  tx(() => { r = restartRows(f, sliceRows(id), h, { by, now, smallRuns }); });
  if (r.error) return r;
  // D8: Resume is the owner's own OK, so "Ask me before each run" must not hold the restart: fire it like Run now.
  // With the switch off nothing holds it, so the ticket keeps its own timing.
  if (featureHoldsTicket(getTicket(r.ticketId))) requestRunNow(r.ticketId, { now, by: by || undefined });
  return { action: 'restart', ticketId: r.ticketId };
}

/** Small runs C4 (D8): the slice's newest `waiting` change entry is newer than its pipeline's start. */
function changedSinceStart(f, h) {
  const entries = Array.isArray(f.outline.changes) ? f.outline.changes : [];
  const last = [...entries].reverse().find((e) => e && e.case === 'waiting' && e.run === h.index);
  if (!last || !h.pipelineId) return false;
  const p = getDb().prepare('SELECT started_at FROM pipelines WHERE id = ?').get(String(h.pipelineId));
  const started = p && p.started_at ? Date.parse(p.started_at) : NaN;
  return !Number.isFinite(started) || Date.parse(last.at) > started;
}

/** The tx-free restart body of resumeFeature (D5): a new ticket for slice `h.index` from `f.outline` (slice 1: due now on
 *  the feature's source branch with the origin's tags; slice k: after slice k−1's ref, policy done), the row re-pointed at
 *  it and the waiting slices after it re-chained. The hold check and requestRunNow stay with the callers, after their
 *  commit. → {ticketId} | {status, error} (nothing written) */
export function restartRows(f, rows, h, { by = null, now = Date.now(), smallRuns = shaperSmallRunsOn() } = {}) {
  const id = f.id;
  const prev = h.index > 1 ? rows[h.index - 2] : null;
  // F43: createTicket throws on {kind:'pipeline', id:null}. A previous slice with no pipeline has not run (e.g. this
  // slice was started early with Run now): nothing to chain after. Small runs: it chains after that slice's ticket
  // (dev's stored shape; the slice gate decides when it fires).
  const prevRef = !prev ? null : prev.pipelineId ? { kind: 'pipeline', id: prev.pipelineId }
    : smallRuns && prev.ticketId ? { kind: 'ticket', id: prev.ticketId } : null;
  if (prev && !prevRef) return { status: 409, error: `slice ${prev.index} has not run yet: start it first` };
  // s3 (D12): a requirements-first follow-up restarts requirements first; the flag lives only in its old ticket's request.
  const old = rows[h.index - 1]?.ticketId ? getTicket(rows[h.index - 1].ticketId, { withRequest: true }) : null;
  const request = { ...sliceRequest({ feature: { id, title: f.title }, index: h.index, outline: f.outline, perspectives: f.perspectives,
    workflowId: f.workflow_id, base: f.base, projectDir: f.project_dir, startedBy: by,
    sourceBranch: prev ? null : f.source_branch || null, requirementsFirst: old?.request?.shape?.requirementsFirst === true }),
    ...(prev ? {} : originCarry(f)) };   // s2: chained restarts inherit at fire
  const t = createTicket({
    title: sliceTitle(f.title, h.index, rows.length, f.outline.slices[h.index - 1]), projectDir: f.project_dir, request,
    ...(prev ? { after: prevRef, afterPolicy: 'done', sourceFromPrevious: true } : { runAtMs: now }),
    createdBy: by, now,
  });
  // The row now follows the new ticket. For k = 1 the thread's run stays reachable through origin_pipeline_id (F48).
  getDb().prepare('UPDATE shape_feature_slices SET ticket_id = ?, pipeline_id = NULL WHERE feature_id = ? AND idx = ?').run(t.id, id, h.index);
  // The new ticket is fresh, so pointing the next slice at it cannot form a cycle; later ones keep their own ref.
  let after = { kind: 'ticket', id: t.id };
  for (const r of rows.slice(h.index)) {
    if (!r.ticket || !['scheduled', 'missed'].includes(r.ticket.status)) break;
    updateTicket(r.ticketId, { after }, { now, by });
    after = { kind: 'ticket', id: r.ticketId };
  }
  return { ticketId: t.id };
}

const BUSY = new Set(['starting', 'shaping', 'questions', 'approval', 'running']);

/** A slice row that is going. A ticket fired with no pipeline yet counts only while the scheduler still waits on it
 *  (predecessorState): one that never got a run ("could not start") must not stall the feature's other slices. */
function rowGoing(r, live, { now = Date.now(), isLive = null } = {}) {
  // Small runs C3 (D8): a run waiting on an unanswered stop question does not hold the feature's other runs; one whose
  // answer is held waits for its turn, so it counts as going.
  const l = r.pipelineId ? live(r.pipelineId) : null;
  // Slice 5 (D2): a run being resumed at server start holds the turn until its resume is live or fails.
  if (l && l.resuming && shaperSmallRunsOn()) return true;
  // Slice 3 (D13): one taking work in before its answer goes on counts as going too.
  if (l && l.stop && !l.stop.held && !l.stop.going) return false;
  if (!BUSY.has(sliceState(r, live, { held: false }))) return false;
  if (r.pipelineId || !r.ticketId) return true;
  return predecessorState({ kind: 'ticket', id: r.ticketId }, { now, isLive }).state === 'waiting';
}

/** Shaper small runs: the feature's slice that is going (starting, running, or live and waiting for a person's
 *  answer), other than slice `exclude`; a paused one is not going. → {index} | null */
export function busySliceOf(featureId, { exclude = null, live = () => null, now = Date.now(), isLive = null } = {}) {
  const r = sliceRows(featureId).find((x) => x.index !== exclude && rowGoing(x, live, { now, isLive }));
  return r ? { index: r.index } : null;
}

// A dependency whose run halted (stopped, error, interrupted) can still be resumed or restarted: its dependent waits.
const HALTED_PIPELINE = new Set(['stopped', 'error', 'interrupted']);
/** A slice row's current ref: its ticket (a later slice, or a restarted one), else its pipeline (slice 1 = origin). */
const rowRef = (r) => (r.ticketId ? { kind: 'ticket', id: r.ticketId } : r.pipelineId ? { kind: 'pipeline', id: r.pipelineId } : null);

/** Slice 2 (D1): what holds run `index` of feature `f` by its builds-on links (`dependsOn`), the gate's one dependency
 *  rule. An unfinished or halted (resumable) dependency → its run number in `waitsFor` (sorted); the first missed,
 *  canceled, could-not-start, archived or removed one, in `dependsOn` order → `bad` (predecessorState's reason, the
 *  dependency's title). A `dependsOn` id with no slice row neither waits nor blocks. Reads only. */
function sliceHolds(f, rows, index, { now = Date.now(), isLive = null, bySlice = new Map(rows.map((r) => [r.sliceId, r])) } = {}) {
  const dependsOn = f.outline.slices[index - 1]?.dependsOn;
  const deps = (Array.isArray(dependsOn) ? dependsOn : []).map((id) => bySlice.get(id)).filter((r) => r && r.index !== index);
  const waitsFor = [];
  let bad = null;
  for (const d of deps) {
    const ref = rowRef(d);
    const p = ref ? predecessorState(ref, { policy: 'done', now, isLive }) : { state: 'gone', reason: 'was removed', title: d.title };
    if (p.state === 'ok') continue;
    if (p.state === 'waiting' || (p.state === 'bad' && HALTED_PIPELINE.has(p.status))) waitsFor.push(d.index);
    else if (!bad) bad = { run: d.index, reason: p.reason, title: p.title || d.title };
  }
  return { waitsFor: waitsFor.sort((a, b) => a - b), bad };
}

/** "Ask me before each run" holds every slice ticket of an active feature (featureHoldsTicket, read once per feature). */
const featureHeldOf = (f) => f.status === 'active' && f.approve_each === 1;

/** Slice 2 (D2): a run that is due: not started, its ticket scheduled, the feature not holding it, no clash hold (D11),
 *  free of its links. `holdsOf()` (its sliceHolds) is read last, only for a row the cheap checks leave due. */
const dueRow = (r, holdsOf, featureHeld) => {
  if (r.pipelineId || !r.ticket || r.ticket.status !== 'scheduled' || featureHeld || clashHoldOf(r.ticketId)) return false;
  const holds = holdsOf();
  return !!holds && !holds.waitsFor.length && !holds.bad;
};

/** Small runs C4 (D7): a change run takes its turn before any run that is not a change, then the lower run goes first. */
function turnBefore(a, b) {
  const ca = a.kind === 'change';
  const cb = b.kind === 'change';
  return ca === cb ? a.index < b.index : ca;
}

/** Small runs slice 6 (decision d-1): the order held items go on in, lowest run first. A change run gets no priority
 *  among held items. The one source of that order for the `next` label (nextTurnOf) and held-answer delivery.
 *  → a new array of the same `{index}` items, sorted stably by index. */
export function turnOrder(items) {
  return [...items].sort((a, b) => a.index - b.index);
}

/** Slice 2 (D2, D3; owner direction dd8aea6ed corrects D3): the row that goes on next. A started run whose stop answer
 *  is held (`isHeld(row, i)`) waits its turn and goes on before any free run, so the lowest such row has it. Otherwise
 *  the row the scheduler starts first once nothing delays it (a going run or a merge-back delay the turn, not who has
 *  it), from the holds of the not-started rows. null when nothing is held or due, or the feature is not active. */
function nextTurnOf(f, rows, holdsByIndex, isHeld) {
  if (f.status !== 'active') return null;
  const held = turnOrder(rows.filter((r, i) => isHeld(r, i)))[0];
  if (held) return held;
  const featureHeld = featureHeldOf(f);
  let next = null;
  for (const r of rows) {
    if (dueRow(r, () => holdsByIndex.get(r.index), featureHeld) && (!next || turnBefore(r, next))) next = r;
  }
  return next;
}

/**
 * Shaper small runs (D4): whether slice ticket `ticket` may start now. Its builds-on links (`dependsOn`) decide, not
 * the stored linear `after`: an unfinished or halted dependency → waiting; a missed, canceled, could-not-start or
 * archived one → bad (predecessorState's reason, the dependency's title). Then the feature runs one slice at a time:
 * another slice going, an earlier slice that is due and not held, or a finished run still merging back → waiting.
 * → {state:'ok'|'waiting'} | {state:'bad', reason, title} | null (not a slice ticket, or a DB error). Never reads
 * ticketHeld (sliceState with held:false), so ticketHeld can call it.
 */
export function sliceGateState(ticket, { now = Date.now(), isLive = null, live = () => null } = {}) {
  try {
    const at = ticket && ticket.id ? sliceOfTicket(ticket.id) : null;
    if (!at) return null;
    const f = featureRow(at.featureId);
    const rows = sliceRows(at.featureId);
    const bySlice = new Map(rows.map((r) => [r.sliceId, r]));
    const holds = sliceHolds(f, rows, at.index, { now, isLive, bySlice });
    if (holds.bad) return { state: 'bad', reason: holds.bad.reason, title: holds.bad.title };
    if (holds.waitsFor.length) return { state: 'waiting' };
    const others = rows.filter((r) => r.index !== at.index);
    if (others.some((r) => rowGoing(r, live, { now, isLive }))) return { state: 'waiting' };
    const featureHeld = featureHeldOf(f);
    const mine = rows.find((r) => r.index === at.index);
    if (others.some((r) => turnBefore(r, mine) && dueRow(r, () => sliceHolds(f, rows, r.index, { now, isLive, bySlice }), featureHeld))) return { state: 'waiting' };
    if (others.some((r) => r.pipelineId && previousBranchesOf(r.pipelineId, { now })?.pending)) return { state: 'waiting' };
    return { state: 'ok' };
  } catch { return null; }
}

/** Small runs: what a re-plan of the feature carries, from the stored row: every agreed requirement no finished run owns
 *  (`agreed`, in agreed order), the ones a person confirms among them (`confirmed`, role keys) and the finished runs'
 *  indexes (`done`). An id a finished run owns is never carried. Empty lists for an unknown feature. */
export function carriedRequirements(featureId) {
  const f = featureId ? featureRow(featureId) : null;
  if (!f) return { agreed: [], confirmed: [], done: [] };
  const done = sliceRows(f.id).filter((r) => sliceState(r, () => null) === 'done').map((r) => r.index);
  const kinds = requirementKindsOf(j(f.requirement_kinds, null), f.outline).filter((k) => k.kind === 'confirmed' || !done.includes(k.run));
  const ids = new Set(kinds.map((k) => k.id));
  return {
    agreed: (f.outline.agreed || []).filter((a) => ids.has(a.id)).map(({ id, text, example }) => ({ id, text: text || '', ...(example ? { example } : {}) })),
    confirmed: kinds.filter((k) => k.kind === 'confirmed').map(({ id, role }) => ({ id, role })), done,
  };
}

/** Re-plan the rest (L9): cancel what waits, then one new shaped run (slicing on) from the last done slice.
 *  A marked feature with the flag on hands its carried requirements to that run as its agreed list (the slice-requirements
 *  workflow: the brief is the requirements input). That run starts from the run that finished last, which holds every
 *  finished run's work (the source a slice starts from too), not from the highest index. Throws SHIPPING while the Ship lock holds. */
export function replanRest(id, { live = () => null, by = null, now = Date.now() } = {}) {
  const f = featureRow(id);
  if (!f) return null;
  const refused = notActive(f);
  if (refused) return refused;
  const view = featureView(id, { live });
  const busy = busySliceOf(id, { live });
  if (busy) return { status: 409, error: `Slice ${busy.index} is still going: stop it first, then re-plan the rest` };
  const found = shaperSmallRunsOn() && smallRunsOfFeature(id) ? carriedRequirements(id) : null;
  const carried = found && found.agreed.length ? found : null;
  const latest = carried ? finishedSlices(id).at(-1)?.index : null;
  const lastDone = view.slices.find((s) => s.index === latest) || [...view.slices].reverse().find((s) => s.state === 'done');
  // previousBranchesOf → {sourceBranch} | {pending:true} | null (scheduler.mjs:504): the done slice's work branch.
  const prev = lastDone ? previousBranchesOf(lastDone.pipelineId) : null;
  if (prev?.pending) return { status: 409, error: 'the last finished slice is still merging its work back: try again in a moment' };
  if (lastDone && !prev?.sourceBranch) return { status: 409, error: `slice ${lastDone.index} has no branch to start from` };
  const branch = lastDone ? prev.sourceBranch : f.source_branch || null;
  const { top, internal } = requestOptions(f.base, by);
  const request = {
    projectDir: f.project_dir, prompt: replanBrief({ featureTitle: f.title, outline: f.outline, doneCount: view.done, carried }),
    title: `${f.title} · re-plan`,
    workflowId: !carried ? f.workflow_id : f.perspectives.includes('ux') ? SHAPE_UX_SLICE_REQ_WORKFLOW_ID : SHAPE_SLICE_REQ_WORKFLOW_ID, ...top, ...(branch ? { sourceBranch: branch } : {}),
    ...originCarry(f),
    shape: { perspectives: f.perspectives, slices: 'auto', replaces: id },
    internal,
  };
  let ticketId = null;
  tx(() => {
    refuseWhileShipping(id);
    cancelOpenTickets(id, { by, now });
    ticketId = createTicket({ title: request.title, projectDir: f.project_dir, request, runAtMs: now, createdBy: by, now }).id;
    getDb().prepare("UPDATE shape_features SET status = 'replanning', replan_ticket_id = ?, updated_at = ? WHERE id = ?").run(ticketId, iso(now), id);
  });
  return { ticketId };
}

/**
 * Feature D1 (D1): the feature's finished runs in the order they finished, ascending. A run counts when its pipeline is
 * `done` and not archived; it finished at its last step's finish (MAX(pipeline_steps.updated_at), else
 * pipelines.updated_at), a tie putting the higher index later. `exclude` = a pipeline id left out.
 * → Array<{index, pipelineId, finishedAt}>
 */
export function finishedSlices(featureId, { exclude = null } = {}) {
  return getDb().prepare(`SELECT x.idx AS idx, p.id AS pid,
      COALESCE((SELECT MAX(st.updated_at) FROM pipeline_steps st WHERE st.pipeline_id = p.id), p.updated_at) AS finished
    FROM (SELECT s.idx AS idx, COALESCE(s.pipeline_id, t.pipeline_id) AS pid FROM shape_feature_slices s
      LEFT JOIN scheduled_runs t ON t.id = s.ticket_id WHERE s.feature_id = ?) x
    JOIN pipelines p ON p.id = x.pid
    WHERE p.status = 'done' AND p.archived_at IS NULL AND p.id IS NOT ?
    ORDER BY finished ASC, x.idx ASC`).all(String(featureId), exclude == null ? null : String(exclude))
    .map((r) => ({ index: r.idx, pipelineId: r.pid, finishedAt: r.finished }));
}

/**
 * Feature D1 (D2): a marked feature's run PR base. The first run in finish order, or one whose predecessor's PR is
 * MERGED, goes into the feature's root source; any other stacks on the run that finished before it (its work branch),
 * or the root while that branch is pending or unknown. null for a run that is not a finished slice of a marked feature;
 * never throws (a DB error is null).
 */
export function smallRunsPrBase(pipelineId) {
  try {
    const at = pipelineId ? featureOfPipeline(pipelineId) : null;
    if (!at || !smallRunsOfFeature(at.featureId)) return null;
    const order = finishedSlices(at.featureId);
    const i = order.findIndex((s) => s.pipelineId === String(pipelineId));
    if (i < 0) return null;
    // Slice 4 (D7): with the flag on, the list along the real branches decides, unless it fell back.
    const chain = shipChainOf(at.featureId);
    if (chain) return chainBaseOf(chain, String(pipelineId));
    const root = featureRootSource(at.featureId);
    // Slice 3 (D10): a run that took work in is based on the last branch it took in, until that run's PR is MERGED.
    const rec = branchOf(pipelineId);
    if (rec && Array.isArray(rec.tookIn) && rec.tookIn.length && typeof rec.source === 'string' && rec.source) {
      return readPrState(rec.tookIn.at(-1).pipelineId)?.state === 'MERGED' ? root : rec.source;
    }
    if (i === 0) return root;
    const pred = order[i - 1].pipelineId;
    if (readPrState(pred)?.state === 'MERGED') return root;
    const prev = previousBranchesOf(pred);
    return (prev && !prev.pending && prev.sourceBranch) || root;
  } catch { return null; }
}

/** L10: a slice's PR base — a marked feature's (smallRunsPrBase), else the generic stacked base (scheduler.mjs
 *  stackedPrBaseOf); a slice is one chained run. */
export function stackedPrBase(pipelineId, chain) {
  return smallRunsPrBase(pipelineId) ?? stackedPrBaseOf(pipelineId, chain);
}

/** Feature D1 (D4): the order a feature's PRs are opened and marked ready: a marked feature's finished runs in finish
 *  order, then any others in index order; otherwise `view.slices` itself. */
export function shipOrder(view) {
  if (!view || !smallRunsOfFeature(view.id)) return view ? view.slices : [];
  return orderOf(view.id, view.slices);
}

function orderOf(featureId, slices, chain = shipChainOf(featureId)) {
  if (chain) {
    // Slice 4 (D7, D10): the listed runs in chain order, then the runs that have not finished in index order.
    const at = new Map(chain.order.map((o, i) => [o.pipelineId, i]));
    const finished = new Set(chain.rows.map((r) => r.pipelineId));
    return [...slices.filter((s) => s.pipelineId && at.has(s.pipelineId)).sort((a, b) => at.get(a.pipelineId) - at.get(b.pipelineId)),
      ...slices.filter((s) => !s.pipelineId || !finished.has(s.pipelineId))];
  }
  const pos = new Map(finishedSlices(featureId).map((s, i) => [s.pipelineId, i]));
  const done = (s) => !!s.pipelineId && pos.has(s.pipelineId);
  return [...slices.filter(done).sort((a, b) => pos.get(a.pipelineId) - pos.get(b.pipelineId)), ...slices.filter((s) => !done(s))];
}

/** Shaper small runs slice 4 (D2, D5, D6, D8): the one list every Ship reader follows for a marked feature with the flag
 *  on: `shipChain` over the finished runs, with the rows and the root kept for the bases. null with the flag off, for an
 *  unmarked feature, when the rule falls back (a finished run neither listed nor carried) and on a DB error. */
function shipChainOf(featureId) {
  try {
    if (!featureId || !shaperSmallRunsOn() || !smallRunsOfFeature(featureId)) return null;
    const names = (xs) => (Array.isArray(xs) ? xs.map((x) => x && x.branch).filter((b) => typeof b === 'string' && b) : []);
    const rows = finishedSlices(featureId).map((s) => {
      const rec = branchOf(s.pipelineId);
      const branch = workBranchOf(rec);
      return { index: s.index, pipelineId: s.pipelineId, branch: typeof branch === 'string' && branch ? branch : null,
        source: rec && typeof rec.source === 'string' && rec.source ? rec.source : null,
        carries: [...names(rec?.tookIn), ...names(rec?.combined)],
        merged: readPrState(s.pipelineId)?.state === 'MERGED', pending: previousBranchesOf(s.pipelineId)?.pending === true };
    });
    const root = featureRootSource(featureId);
    const chain = shipChain(rows, { root });
    return chain && { ...chain, rows, root };
  } catch { return null; }
}

/** A run's PR base on the chain: a listed run's chain base; a carried run (D9) its recorded source while that is a listed
 *  or carried run's branch whose PR is not MERGED, else the root; null for a run that has not finished. */
function chainBaseOf(chain, pipelineId) {
  const listed = chain.order.find((o) => o.pipelineId === pipelineId);
  if (listed) return listed.base;
  const row = chain.rows.find((r) => r.pipelineId === pipelineId);
  if (!row) return null;
  const owner = row.source && chain.rows.some((r) => r.pipelineId !== pipelineId && r.branch === row.source && !r.merged);
  return owner ? row.source : chain.root;
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
