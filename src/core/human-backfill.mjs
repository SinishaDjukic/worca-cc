// src/core/human-backfill.mjs
// One-shot RUN-LEVEL human-hours backfill for runs recorded before schema v33 (money-saved
// design §6.1). Synchronous (it runs inside the migration ladder), best-effort per run: a
// missing file, an unreadable JSON or an unknown store root contributes 0 and never throws.
// Steps stay NULL — only the run row is credited. Never re-runs on a credited run, and never
// touches a run whose steps already carry an estimate (the step path owns those).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectStorePath, workspaceStorePath } from './store.mjs';
import { estimateStepHours, proseWords, jsonItems, roundHours } from '../shared/human-estimate.mjs';

const TERMINAL = "('done','error','stopped')";   // `interrupted` and `paused` are resumable (stats.mjs buckets them together): the step path owns them
const SKIP_JSON = new Set(['results.json', 'run.json', 'memory.json']);
const MD_DIR_RE = /^(plans|reviews)\//;
const VERSION_RE = /-v(\d+)\.md$/i;

function readTextSafe(path) { try { return readFileSync(path, 'utf8'); } catch { return null; } }

/** The pipeline dir under <root>/pipelines whose name ends with `-<id>` (the run-dir naming). */
function pipelineDirFor(root, id, cache) {
  if (!cache.has(root)) {
    let names = [];
    try { names = readdirSync(join(root, 'pipelines')); } catch { /* no store yet */ }
    cache.set(root, names);
  }
  const name = cache.get(root).find((n) => n.endsWith(`-${id}`));
  return name ? join(root, 'pipelines', name) : null;
}

const producer = (over) => ({ nodeKind: 'agent', agent: { runnerType: 'producer' }, cycle: 1, code: null, outputs: [], reads: null, ...over });

/** db.mjs's hasSqliteTable is not exported; a hand-seeded upgrade fixture may lack a table. */
function hasTable(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function defaultRootFor(row) {
  try {
    return row.target === 'workspace' && row.workspace_key ? workspaceStorePath(row.workspace_key) : projectStorePath(row.project_key);
  } catch { return null; }   // no resolvable home (node:test without WORCA_HOME): credit nothing
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{rootFor?:(row:object)=>string|null}} [opts]
 * @returns {{runs:number, credited:number}}
 */
export function backfillHumanHours(db, { rootFor = defaultRootFor } = {}) {
  if (!hasTable(db, 'artifacts') || !hasTable(db, 'reviews')) return { runs: 0, credited: 0 };
  const rows = db.prepare(`SELECT id, project_key, workspace_key, target FROM pipelines
    WHERE status IN ${TERMINAL} AND human_hours = 0`).all();
  const hasStepEstimate = db.prepare('SELECT 1 AS n FROM pipeline_steps WHERE pipeline_id = ? AND human_hours IS NOT NULL LIMIT 1');
  const reviews = db.prepare('SELECT verdict FROM reviews WHERE pipeline_id = ? ORDER BY rowid');   // every persisted verdict (writeReview)
  const artifacts = db.prepare('SELECT kind, rel_path FROM artifacts WHERE pipeline_id = ? ORDER BY rowid');   // insertion order: a plan, its versions, then the reviews
  const update = db.prepare('UPDATE pipelines SET human_hours = ? WHERE id = ?');
  const dirCache = new Map();
  let credited = 0;
  for (const row of rows) {
    try {
      if (hasStepEstimate.get(row.id)) continue;
      const root = rootFor(row);
      if (!root) continue;
      const pdir = pipelineDirFor(root, row.id, dirCache);
      const pseudo = [];
      let diffLines = 0;
      // code
      const results = pdir ? readTextSafe(join(pdir, 'results.json')) : null;
      if (results) {
        try {
          const s = JSON.parse(results)?.summary || {};
          const ins = s.linesAdded | 0; const del = s.linesRemoved | 0;
          diffLines = ins + del;
          pseudo.push(producer({ code: { files: (s.filesNew | 0) + (s.filesChanged | 0), insertions: ins, deletions: del } }));
        } catch { /* unreadable summary → no code credit */ }
      }
      // prose + json artifacts
      for (const a of artifacts.all(row.id)) {
        const rel = String(a.rel_path || '');
        if (rel.endsWith('.md') && MD_DIR_RE.test(rel)) {
          const text = readTextSafe(join(root, ...rel.split('/')));
          if (text == null) continue;
          const m = VERSION_RE.exec(rel);
          // -vN is the (N−1)-th revision: the refiner's k-th execution mints -v(k+1) and the step
          // path credits it at cycle k (spec §6.1), so the decay here is 0.5^(N−2), never 0.5^(N−1).
          pseudo.push(producer({ cycle: m ? Math.max(1, Number(m[1]) - 1) : 1, outputs: [{ type: 'md', words: proseWords(text), revision: !!m }] }));
        } else if (rel.endsWith('.json') && pdir && !SKIP_JSON.has(rel) && !rel.includes('/')) {   // dir-relative JSON the run indexed (decomposition.json)
          const text = readTextSafe(join(pdir, rel));
          if (text == null) continue;
          let items = 0; try { items = jsonItems(JSON.parse(text)); } catch { /* 0 */ }
          pseudo.push(producer({ outputs: [{ type: 'json', items }] }));
        }
      }
      // verdict JSON: the product persists every per-cycle verdict in reviews.verdict (writeReview);
      // the *-review-cycleN.json file the agent wrote is transient scratch and never an artifacts row.
      let verdicts = 0;
      for (const r of reviews.all(row.id)) {
        verdicts += 1;
        let items = 0; try { items = jsonItems(JSON.parse(r.verdict)); } catch { /* 0 */ }
        pseudo.push(producer({ outputs: [{ type: 'json', items }] }));
      }
      // one verifier read of the full diff when a verdict was written — no agent key involved (rule 6, cycle 1 only)
      if (diffLines > 0 && verdicts > 0) pseudo.push(producer({ agent: { runnerType: 'verifier' }, reads: { diffLines, words: 0 } }));
      const hours = roundHours(pseudo.reduce((sum, e) => sum + estimateStepHours(e).hours, 0));
      if (hours > 0) { update.run(hours, row.id); credited += 1; }
    } catch { /* best-effort per run */ }
  }
  return { runs: rows.length, credited };
}
