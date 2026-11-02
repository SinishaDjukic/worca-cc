// src/core/run-groups.mjs — groups for the Runs list (runs redesign §2, §3.3): Shaper features (their slices, #770)
// and user-created groups, each with its ad-hoc members (run_group_members, schema v65). Plain Run-after chains are not
// here: they come from scheduler.mjs runChains. Synchronous; tx() from db.mjs (never nested).
import { randomUUID } from 'node:crypto';
import { getDb, tx } from './db.mjs';
import { getTicket } from './scheduler.mjs';
import { featureOfPipeline } from './shape/features.mjs';
import { spendOfPipelines } from './stats.mjs';

export class RunGroupError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status; }
}
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const qs = (list) => list.map(() => '?').join(', ');
// D3: the stored CI verdict (pr_verdict, written by artifacts.mjs persistPrState) rides on the member's PR, as
// readPrState spreads it, so a member whose History row has no PR yet still says "Checks failing". No Watch PR read:
// this route stays one DB pass.
const prOf = (r) => {
  if (!r || (!r.pr_url && r.pr_number == null)) return null;
  let v = null;
  try { v = r.pr_verdict ? JSON.parse(r.pr_verdict) : null; } catch { v = null; }
  return { url: r.pr_url || null, number: r.pr_number ?? null, state: r.pr_state || null, ...(v && typeof v === 'object' ? v : {}) };
};
// An after-ticket's run_at is a far-future sentinel (scheduler.mjs AFTER_RUN_AT): never a start time.
const ticketOf = (t) => (t ? { id: t.id, status: t.status, runAt: t.after ? null : (t.runAt || null), after: !!t.after } : null);

function pipelineRows(ids) {
  if (!ids.length) return new Map();
  // Deleted rows are read too: purgePipeline keeps the row and its status, and a deleted feature slice must still
  // count as the slice it was (3/3 done), not fall through runModel to 'stopped' and become the group's current member.
  const rows = getDb().prepare(`SELECT id, title, status, pr_url, pr_number, pr_state, pr_verdict, project_key FROM pipelines
    WHERE id IN (${qs(ids)})`).all(...ids);
  return new Map(rows.map((r) => [r.id, r]));
}

/** Every group the Runs list folds rows into: { id, kind:'feature'|'user', title, projectKey, planning, members:[{position,
 *  title, pipelineId, ticketId, status, pr, ticket, adhoc, after}] }. Features: every one not replaced by a re-plan,
 *  finished ones included. A group with no listable member is left out. */
export function listRunGroups() {
  const db = getDb();
  const feats = db.prepare("SELECT id, title, origin_pipeline_id FROM shape_features WHERE status != 'replanned' ORDER BY created_at").all();
  const users = db.prepare('SELECT id, title, project_key, name_source FROM run_groups ORDER BY created_at').all();
  const fids = feats.map((f) => f.id);
  const slices = fids.length ? db.prepare(`SELECT s.feature_id, s.idx, s.title, s.ticket_id, COALESCE(s.pipeline_id, t.pipeline_id) AS pipeline_id
    FROM shape_feature_slices s LEFT JOIN scheduled_runs t ON t.id = s.ticket_id
    WHERE s.feature_id IN (${qs(fids)}) ORDER BY s.feature_id, s.idx`).all(...fids) : [];
  const gids = [...fids, ...users.map((u) => u.id)];
  const adhoc = gids.length ? db.prepare(`SELECT pipeline_id, group_id, position FROM run_group_members
    WHERE group_id IN (${qs(gids)}) ORDER BY group_id, position`).all(...gids) : [];
  const origins = feats.map((f) => f.origin_pipeline_id).filter(Boolean);
  const rows = pipelineRows([...new Set([...slices.map((s) => s.pipeline_id), ...adhoc.map((a) => a.pipeline_id), ...origins].filter(Boolean))]);
  const member = (position, title, pipelineId, ticketId, isAdhoc) => {
    const p = pipelineId ? rows.get(pipelineId) : null;
    const tk = !pipelineId && ticketId ? getTicket(ticketId) : null;
    // A native slice reads its slice title ("1 · Store tags"): its run title repeats the feature and the position
    // ("Run tags · 1/3: Store tags"). An ad-hoc member has only its run's title.
    return { position, title: (isAdhoc ? p && p.title : title) || (p && p.title) || '', pipelineId: pipelineId || null, ticketId: ticketId || null,
      status: p ? p.status : null, pr: prOf(p), ticket: ticketOf(tk), afterRef: tk && tk.after ? String(tk.after.id) : null, adhoc: isAdhoc };
  };
  // D29: `after` = the position of the member a waiting slice runs after, so it reads "Waiting · starts after run 2".
  const withAfter = (list) => list.map(({ afterRef, ...m }) => ({ ...m,
    after: afterRef ? (list.find((x) => x.ticketId === afterRef || x.pipelineId === afterRef) || {}).position || null : null }));
  const withAdhoc = (id, base) => {
    const extra = adhoc.filter((a) => a.group_id === id && rows.has(a.pipeline_id));
    return [...base, ...extra.map((a, i) => member(base.length + i + 1, '', a.pipeline_id, null, true))];
  };
  // Spec §2.3, decision 4: a planning run counts in the group bar, listed as "Planning", never in the count. The
  // origin run is normally slice 1 itself (createSliceFeature), already in the bar: only a separate one is named.
  const planningOf = (f, sliceIds) => {
    const p = f.origin_pipeline_id && !sliceIds.has(f.origin_pipeline_id) ? rows.get(f.origin_pipeline_id) : null;
    return p ? { pipelineId: p.id, title: 'Planning', status: p.status } : null;
  };
  const out = feats.map((f) => {
    const own = slices.filter((s) => s.feature_id === f.id);
    return { id: f.id, kind: 'feature', title: f.title, projectKey: null, planning: planningOf(f, new Set(own.map((s) => s.pipeline_id).filter(Boolean))),
      members: withAfter(withAdhoc(f.id, own.map((s) => member(s.idx, s.title, s.pipeline_id, s.ticket_id, false)))) };
  });
  for (const u of users) out.push({ id: u.id, kind: 'user', title: u.title, nameSource: u.name_source || 'user', projectKey: u.project_key || null, planning: null, members: withAfter(withAdhoc(u.id, [])) });
  return out.filter((g) => g.members.length).map((g) => ({ ...g, cost: groupCost(g) }));
}

/** Every pipeline whose cost belongs to a feature (§2.4): its origin (planning) run, its slices' runs, earlier attempts
 *  of a slice (an old ticket whose request names the feature) and, walking `replaces`, every earlier round. */
function featurePipelineIds(featureId, seen = new Set()) {
  if (!featureId || seen.has(featureId)) return [];
  seen.add(featureId);
  const db = getDb();
  const f = db.prepare('SELECT origin_pipeline_id, replaces FROM shape_features WHERE id = ?').get(String(featureId));
  if (!f) return [];
  const slices = db.prepare(`SELECT COALESCE(s.pipeline_id, t.pipeline_id) AS id FROM shape_feature_slices s
    LEFT JOIN scheduled_runs t ON t.id = s.ticket_id WHERE s.feature_id = ?`).all(String(featureId)).map((r) => r.id);
  const tries = db.prepare(`SELECT pipeline_id AS id FROM scheduled_runs WHERE pipeline_id IS NOT NULL
    AND json_extract(request, '$.shape.slice.feature') = ?`).all(String(featureId)).map((r) => r.id);
  return [f.origin_pipeline_id, ...slices, ...tries, ...featurePipelineIds(f.replaces, seen)].filter(Boolean);
}

/** Watch PR fix runs started for any of these runs' PRs. */
function fixRunIds(ids) {
  if (!ids.length) return [];
  return getDb().prepare(`SELECT r.pipeline_id AS id FROM pr_watch_runs r JOIN pr_watches w ON w.pr_url = r.pr_url
    WHERE r.pipeline_id IS NOT NULL AND w.pipeline_id IN (${qs(ids)})`).all(...ids).map((r) => r.id);
}

/** §2.4: the group's cost with Statistics' per-row rule: { usd, byPipeline }. */
function groupCost(g) {
  const base = [...(g.kind === 'feature' ? featurePipelineIds(g.id) : []), ...g.members.map((m) => m.pipelineId).filter(Boolean)];
  return spendOfPipelines([...base, ...fixRunIds([...new Set(base)])]);
}

function groupExists(id) {
  const db = getDb();
  return !!(db.prepare('SELECT 1 FROM run_groups WHERE id = ?').get(String(id))
    || db.prepare("SELECT 1 FROM shape_features WHERE id = ? AND status != 'replanned'").get(String(id)));
}

const NAME_SOURCES = new Set(['suggested', 'user']);
const SKIP = {
  'not-found': ['NOT_FOUND', 'run not found', 404],
  already: ['IN_GROUP', 'the run is already in this group', 409],
  feature: ['IN_GROUP', 'the run is part of a Shaper feature', 409],
};
/** A skip as the refusal a single-run write answers (the old addToGroup / createRunGroup errors). */
export const skipError = (s) => { const [code, msg, status] = SKIP[(s && s.reason) || 'not-found']; return new RunGroupError(code, msg, status); };

/** Which runs can join `groupId` (null: a new group): { ok, skipped: [{ pipelineId, reason }] }. A run in another
 *  user group is ok (it moves); a Shaper slice or planning run never joins a group. */
function sortRuns(db, ids, groupId) {
  const ok = [];
  const skipped = [];
  for (const pid of [...new Set((ids || []).map(String))]) {
    if (!db.prepare('SELECT 1 FROM pipelines WHERE id = ? AND deleted_at IS NULL').get(pid)) skipped.push({ pipelineId: pid, reason: 'not-found' });
    else if (groupId && db.prepare('SELECT 1 FROM run_group_members WHERE pipeline_id = ? AND group_id = ?').get(pid, String(groupId))) skipped.push({ pipelineId: pid, reason: 'already' });
    else if (featureOfPipeline(pid)) skipped.push({ pipelineId: pid, reason: 'feature' });
    else ok.push(pid);
  }
  return { ok, skipped };
}

/** What Undo puts back: each run's membership row (group_id null = ungrouped) and the user groups they were in. */
function snapshotRuns(db, ids) {
  const members = ids.map((pid) => ({ ...(db.prepare('SELECT pipeline_id, group_id, position, added_by, added_at FROM run_group_members WHERE pipeline_id = ?').get(pid)
    || { pipeline_id: pid, group_id: null }) }));
  const gids = [...new Set(members.map((m) => m.group_id).filter(Boolean))];
  return { members, groups: gids.map((g) => db.prepare('SELECT * FROM run_groups WHERE id = ?').get(g)).filter(Boolean).map((g) => ({ ...g })), created: null };
}

const dropIfEmpty = (db, gid) => {
  if (!db.prepare('SELECT 1 FROM run_group_members WHERE group_id = ?').get(gid)) db.prepare('DELETE FROM run_groups WHERE id = ?').run(gid);
};

/** Inside a tx: the runs join `groupId` as its last members, leaving their old group (deleted when that empties it).
 *  Native feature slices take positions 1..N in listRunGroups; this position only orders the ad-hoc members. */
function placeRuns(db, groupId, ids, by, now) {
  const left = new Set();
  let pos = db.prepare('SELECT COALESCE(MAX(position), 0) AS n FROM run_group_members WHERE group_id = ?').get(groupId).n;
  for (const pid of ids) {
    const was = db.prepare('SELECT group_id FROM run_group_members WHERE pipeline_id = ?').get(pid);
    if (was) { left.add(was.group_id); db.prepare('DELETE FROM run_group_members WHERE pipeline_id = ?').run(pid); }
    pos += 1;
    db.prepare('INSERT INTO run_group_members (pipeline_id, group_id, position, added_by, added_at) VALUES (?, ?, ?, ?, ?)')
      .run(pid, groupId, pos, by, iso(now));
  }
  db.prepare('UPDATE run_groups SET updated_at = ? WHERE id = ?').run(iso(now), groupId);
  for (const g of left) if (g !== groupId) dropIfEmpty(db, g);
}

const groupTitle = (db, id) => db.prepare('SELECT title FROM run_groups WHERE id = ?').get(id)?.title
  || db.prepare('SELECT title FROM shape_features WHERE id = ?').get(id)?.title || '';

/** §3.3 + Add to group: the runs join the group (moving out of another user group); slices and missing runs are
 *  skipped. { groupId, group: { id, title }, added, skipped, snap }. */
export function addRunsToGroup({ groupId, pipelineIds, by = null, now = Date.now() }) {
  const gid = String(groupId);
  if (!groupExists(gid)) throw new RunGroupError('NOT_FOUND', 'group not found', 404);
  const db = getDb();
  const { ok, skipped } = sortRuns(db, pipelineIds, gid);
  const snap = snapshotRuns(db, ok);
  if (ok.length) tx(() => placeRuns(db, gid, ok, by, now));
  return { groupId: gid, group: { id: gid, title: groupTitle(db, gid) }, added: ok, skipped, snap };
}

/** The single-run form the tests and older callers use: throws the skip as before (IN_GROUP, NOT_FOUND). */
export function addToGroup({ groupId, pipelineId, by = null, now = Date.now() }) {
  const r = addRunsToGroup({ groupId, pipelineIds: [pipelineId], by, now });
  if (!r.added.length) throw skipError(r.skipped[0]);
  return { groupId: r.groupId, pipelineId: String(pipelineId) };
}

/** New group: created together with its runs (never empty). `pipelineId` is the one-run form. */
export function createRunGroup({ title, nameSource = 'user', pipelineId, pipelineIds, by = null, now = Date.now() }) {
  const t = String(title || '').trim();
  if (!t || t.length > 120) throw new RunGroupError('BAD_TITLE', 'a group needs a name (1-120 characters)', 400);
  if (!NAME_SOURCES.has(nameSource)) throw new RunGroupError('BAD_NAME_SOURCE', "nameSource is 'suggested' or 'user'", 400);
  const db = getDb();
  const { ok, skipped } = sortRuns(db, pipelineIds || [pipelineId], null);
  if (!ok.length) throw skipError(skipped[0]);
  const snap = snapshotRuns(db, ok);
  const id = `grp_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const pk = db.prepare('SELECT project_key FROM pipelines WHERE id = ?').get(ok[0])?.project_key || null;
  tx(() => {
    db.prepare('INSERT INTO run_groups (id, title, project_key, created_by, created_at, updated_at, name_source) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, t, pk, by, iso(now), iso(now), nameSource);
    placeRuns(db, id, ok, by, now);
  });
  return { id, title: t, nameSource, added: ok, skipped, snap: { ...snap, created: id } };
}

/** Undo of an add or a create: every run back in its old group (a group the move deleted comes back with its id,
 *  name and source); a group the add created, or one the undo empties, is deleted. A run deleted since is skipped. */
export function restoreRunGroups(snap) {
  const db = getDb();
  tx(() => {
    for (const g of snap.groups) {
      db.prepare('INSERT OR IGNORE INTO run_groups (id, title, project_key, created_by, created_at, updated_at, name_source) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(g.id, g.title, g.project_key, g.created_by, g.created_at, g.updated_at, g.name_source || 'user');
    }
    const touched = new Set(snap.created ? [snap.created] : []);
    for (const m of snap.members) {
      const cur = db.prepare('SELECT group_id FROM run_group_members WHERE pipeline_id = ?').get(m.pipeline_id);
      if (cur) touched.add(cur.group_id);
      db.prepare('DELETE FROM run_group_members WHERE pipeline_id = ?').run(m.pipeline_id);
      if (m.group_id && db.prepare('SELECT 1 FROM pipelines WHERE id = ? AND deleted_at IS NULL').get(m.pipeline_id)) {
        db.prepare('INSERT INTO run_group_members (pipeline_id, group_id, position, added_by, added_at) VALUES (?, ?, ?, ?, ?)')
          .run(m.pipeline_id, m.group_id, m.position, m.added_by, m.added_at);
      }
    }
    for (const g of touched) dropIfEmpty(db, g);
  });
}

/** The suggest-name prompt's input: each run's title and prompt, or null when one is missing or deleted. */
export function runNameInputs(ids) {
  if (!ids.length) return null;
  const rows = getDb().prepare(`SELECT id, title, prompt FROM pipelines WHERE deleted_at IS NULL AND id IN (${qs(ids)})`).all(...ids);
  if (rows.length !== ids.length) return null;
  const by = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => ({ title: by.get(id).title || '', firstMessage: by.get(id).prompt || '' }));
}

/** ⋯ → Remove from group (ad-hoc members only). A user group left empty is deleted. */
export function removeFromGroup({ pipelineId }) {
  const db = getDb();
  const m = db.prepare('SELECT group_id FROM run_group_members WHERE pipeline_id = ?').get(String(pipelineId));
  if (!m) {
    if (featureOfPipeline(pipelineId)) throw new RunGroupError('NATIVE_MEMBER', 'a Shaper slice cannot leave its feature');
    throw new RunGroupError('NOT_FOUND', 'the run is not in a group', 404);
  }
  tx(() => {
    db.prepare('DELETE FROM run_group_members WHERE pipeline_id = ?').run(String(pipelineId));
    const left = db.prepare('SELECT COUNT(*) AS n FROM run_group_members WHERE group_id = ?').get(m.group_id).n;
    if (!left) db.prepare('DELETE FROM run_groups WHERE id = ?').run(m.group_id);
  });
  return { groupId: m.group_id };
}

/** The members a bulk action on a feature or user group expands to (src/core/run-bulk.mjs). */
export function groupMembers(groupId) {
  const g = listRunGroups().find((x) => x.id === String(groupId));
  return g ? g.members : [];
}
