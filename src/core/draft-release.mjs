// src/core/draft-release.mjs — Shaper s4: the release row's server half. The version hint for the Ship card and the
// Ship it dialog, the single run's stored choice, and the pass the PR-state poller runs: a ship PR (a feature's one
// PR, or its last slice's PR when stacked; a single run's PR) seen MERGED gets exactly one DRAFT release.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from './db.mjs';
import { findPipelineRowById } from './artifacts.mjs';
import { membersOfRow } from './checkout.mjs';
import { latestTag, prLifecycleState, createDraftRelease } from './git-info.mjs';
import { featureView } from './shape/features.mjs';
import { suggestReleaseVersion } from '../shared/release-version.mjs';

const iso = (ms) => new Date(ms).toISOString();

/** { version, from:'tag'|'package'|null, lastTag, packageVersion }; never throws. */
export async function releaseVersionHint(repoDir) {
  let lastTag = null; let packageVersion = null;
  try { lastTag = repoDir ? await latestTag(repoDir) : null; } catch { /* no tag */ }
  try {
    const p = JSON.parse(readFileSync(join(repoDir, 'package.json'), 'utf8'));
    if (typeof p.version === 'string' && p.version.trim()) packageVersion = p.version.trim();
  } catch { /* no package.json */ }
  return { ...suggestReleaseVersion({ lastTag, packageVersion }), lastTag, packageVersion };
}

/** The single-run Ship it dialog's choice; ignored once a release was claimed for the run. */
export function recordRunRelease(pipelineId, { version, target = null }) {
  return getDb().prepare(`UPDATE pipelines SET release_version = ?, release_target = ?, release_error = NULL
      WHERE id = ? AND release_at IS NULL`).run(version, target, String(pipelineId)).changes > 0;
}

function pendingReleases() {
  const db = getDb();
  // The ship PR: the one PR, else (stacked) the last slice's PR. featureView resolves slices 2..N's pipeline id through
  // their fired ticket (shape_feature_slices.pipeline_id is null for them), so never read that column here.
  const feats = db.prepare(`SELECT id, project_dir AS projectDir, release_version AS version, release_target AS target,
      ship_pr_url AS shipPr FROM shape_features
    WHERE release_version IS NOT NULL AND ship_mode IS NOT NULL AND release_at IS NULL`).all()
    .map((r) => {
      let last = null;
      try { last = featureView(r.id)?.ship?.lastPrUrl || null; } catch { /* a broken row is skipped this pass */ }
      return { table: 'shape_features', id: r.id, projectDir: r.projectDir, version: r.version, target: r.target,
        prUrl: r.shipPr || last };
    });
  const runs = db.prepare(`SELECT id, pr_url AS prUrl, release_version AS version, release_target AS target FROM pipelines
      WHERE release_version IS NOT NULL AND release_at IS NULL AND pr_url IS NOT NULL`).all()
    .map((r) => ({ table: 'pipelines', id: r.id, version: r.version, target: r.target, prUrl: r.prUrl,
      projectDir: membersOfRow(findPipelineRowById(r.id)).find((m) => m.projectDir)?.projectDir || null }));
  return [...feats, ...runs].filter((p) => p.prUrl && p.projectDir);
}

let busy = false;
/** One pass. → { created:[{table,id,url}], failed:[{table,id,error}] } (null when a pass is already running). */
export async function draftReleasesOnMerge({ prState = prLifecycleState, createRelease = createDraftRelease, now = Date.now } = {}) {
  if (busy) return null;
  busy = true;
  const created = []; const failed = [];
  try {
    for (const p of pendingReleases()) {
      let state = null;
      try { state = await prState({ projectDir: p.projectDir, prUrl: p.prUrl }); } catch { state = null; }
      if (state !== 'MERGED') continue;
      // The claim: only the pass that sets release_at creates; a later pass (or a second server) skips the row.
      // p.table is one of two literals set above, never request data.
      const claimed = getDb().prepare(`UPDATE ${p.table} SET release_at = ? WHERE id = ? AND release_at IS NULL`)
        .run(iso(now()), p.id).changes > 0;
      if (!claimed) continue;
      let r;
      try { r = await createRelease({ projectDir: p.projectDir, prUrl: p.prUrl, tag: p.version, target: p.target }); }
      catch (err) { r = { ok: false, error: err?.message || String(err) }; }
      if (r.ok) {
        getDb().prepare(`UPDATE ${p.table} SET release_url = ? WHERE id = ?`).run(r.url || null, p.id);
        created.push({ table: p.table, id: p.id, url: r.url || null });
      } else {
        getDb().prepare(`UPDATE ${p.table} SET release_error = ? WHERE id = ?`).run(String(r.error || 'failed'), p.id);
        failed.push({ table: p.table, id: p.id, error: r.error });
      }
    }
  } finally { busy = false; }
  return { created, failed };
}
