// tools/record-upgrade-snapshot.mjs — record a scrubbed copy of a Worca DB for test/upgrade-snapshot.test.mjs:
// the rows the Runs list reads (runs, steps, features, slices, schedules, tickets). Only the allowlisted columns are
// copied (KEEP), and every title, path and id among them is replaced.
// Usage: node tools/record-upgrade-snapshot.mjs --db FILE --out test/fixtures/upgrade-snapshot/dev-v60.json
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

// The columns the list, the groups and the migration read. Everything else (prompts, branches, steppers, tools,
// fail_reason, last_result, exec_result, source_branch, owners, Ask ids, any column added later) is left out.
export const KEEP = Object.freeze({
  pipelines: ['id', 'project_key', 'workspace_key', 'target', 'title', 'status', 'phase', 'cycle', 'started_at', 'updated_at',
    'total_cost_usd', 'total_active_ms', 'resume_point', 'archived_at', 'pr_url', 'pr_number', 'pr_state', 'pr_checked_at',
    'outcome', 'scheduled_for', 'schedule_id', 'human_hours', 'run_size', 'cost_cap_override'],
  pipeline_steps: ['pipeline_id', 'key', 'node_id', 'phase', 'step_index', 'cycle', 'status', 'started_at', 'updated_at',
    'active_ms', 'running_since', 'cost_usd', 'ended_at'],
  shape_features: ['id', 'title', 'project_dir', 'origin_pipeline_id', 'outline', 'request_base', 'perspectives', 'workflow_id',
    'approve_each', 'status', 'proposed', 'merges', 'removals', 'replaces', 'replaced_by', 'created_at', 'updated_at'],
  shape_feature_slices: ['feature_id', 'idx', 'slice_id', 'title', 'ticket_id', 'pipeline_id'],
  schedules: ['id', 'title', 'project_key', 'project_dir', 'request', 'rule', 'overlap', 'max_failures', 'failure_streak',
    'if_missed', 'grace_min', 'status', 'runs_count', 'next_run_at', 'created_at', 'updated_at'],
  scheduled_runs: ['id', 'schedule_id', 'title', 'project_key', 'project_dir', 'run_at', 'request', 'status', 'if_missed',
    'grace_min', 'attempts', 'queued', 'forced', 'pipeline_id', 'after_kind', 'after_id', 'after_policy',
    'source_from_previous', 'resume_pipeline_id', 'created_at', 'updated_at'],
});
const TABLES = Object.keys(KEEP);

export function scrubSnapshot(raw) {
  const maps = new Map();
  const mapper = (prefix, width = 3) => (v) => {
    if (v == null) return v;
    if (!maps.has(prefix)) maps.set(prefix, new Map());
    const m = maps.get(prefix);
    if (!m.has(v)) m.set(v, `${prefix}${String(m.size + 1).padStart(width, '0')}`);
    return m.get(v);
  };
  const pid = mapper('snap-');
  const proj = mapper('snap-proj-', 8);                // "snap-proj-00000001": the real slug-hex8 key shape
  const ws = mapper('ws-snap-');
  const feat = mapper('feat_snap');
  const sched = mapper('sch_snap');
  const dirOf = mapper('/snapshot/dir-');              // features carry a dir, not a key
  const n = { run: 0, feature: 0, sched: 0 };
  const dir = (key) => (key == null ? null : `/snapshot/${key}`);
  const keep = (t, r) => Object.fromEntries(KEEP[t].filter((k) => k in r).map((k) => [k, r[k]]));
  // outcome also holds every token's artifact path; the list reads only runEngine (RUN_ENGINE_SQL) and endReached.
  const outcomeOnly = (v) => { try { const j = JSON.parse(v); return j && typeof j === 'object' ? JSON.stringify({ endReached: !!j.endReached, ...(typeof j.runEngine === 'string' ? { runEngine: j.runEngine } : {}) }) : null; } catch { return null; } };
  const pauseOnly = (v) => { try { const j = JSON.parse(v); return j && j.pauseReason ? JSON.stringify({ pauseReason: j.pauseReason }) : null; } catch { return null; } };
  const T = raw.tables;
  const out = { recordedAt: raw.recordedAt || null, schemaVersion: raw.schemaVersion, tables: {} };
  out.tables.pipelines = (T.pipelines || []).map((r) => ({ ...keep('pipelines', r),
    id: pid(r.id), project_key: proj(r.project_key), workspace_key: ws(r.workspace_key), title: `Run ${++n.run}`,
    pr_url: r.pr_number ? `https://github.com/acme/app/pull/${r.pr_number}` : null,
    schedule_id: sched(r.schedule_id),
    resume_point: pauseOnly(r.resume_point),           // only the pause reason listAllPipelines reads
    outcome: r.outcome == null ? null : outcomeOnly(r.outcome),
  }));
  out.tables.pipeline_steps = (T.pipeline_steps || []).map((r) => ({ ...keep('pipeline_steps', r), pipeline_id: pid(r.pipeline_id) }));
  out.tables.shape_features = (T.shape_features || []).map((r) => ({ ...keep('shape_features', r),
    id: feat(r.id), title: `Feature ${++n.feature}`, project_dir: dirOf(r.project_dir),
    origin_pipeline_id: pid(r.origin_pipeline_id), outline: '{"slices":[]}', request_base: '{}',
    replaces: feat(r.replaces), replaced_by: feat(r.replaced_by) }));
  out.tables.shape_feature_slices = (T.shape_feature_slices || []).map((r) => ({ ...keep('shape_feature_slices', r),
    feature_id: feat(r.feature_id), title: `Slice ${r.idx}`, pipeline_id: pid(r.pipeline_id) }));
  out.tables.schedules = (T.schedules || []).map((r) => ({ ...keep('schedules', r),
    id: sched(r.id), title: `Schedule ${++n.sched}`, project_key: proj(r.project_key), project_dir: dir(proj(r.project_key)), request: '{}' }));
  out.tables.scheduled_runs = (T.scheduled_runs || []).map((r) => ({ ...keep('scheduled_runs', r),
    schedule_id: sched(r.schedule_id),
    title: r.title == null ? null : `Run ${++n.run}`, project_key: proj(r.project_key), project_dir: dir(proj(r.project_key)), request: '{}',
    pipeline_id: pid(r.pipeline_id), resume_pipeline_id: pid(r.resume_pipeline_id),
    after_id: r.after_kind === 'pipeline' ? pid(r.after_id) : r.after_id }));
  return out;
}

function readDb(file) {
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  const tables = {};
  for (const t of TABLES) {
    const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
    tables[t] = has ? db.prepare(`SELECT * FROM ${t}`).all().map((r) => ({ ...r })) : [];
  }
  const schemaVersion = db.prepare('PRAGMA user_version').get().user_version;
  db.close();
  return { recordedAt: new Date().toISOString().slice(0, 10), schemaVersion, tables };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (f) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : null; };
  const db = arg('--db');
  const out = arg('--out');
  if (!db || !out) { console.error('usage: --db FILE --out FILE'); process.exit(2); }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(scrubSnapshot(readDb(db)), null, 1) + '\n');
}
