// src/core/ask/run-card-extras.mjs — worca Chat P3: the result facts the chat run card shows for a finished run,
// shaped from results.json (src/core/results.mjs assembleResults) and the artifact index. Pure: no I/O. The server
// reads the file and the index (ui/server.mjs askRunCardExtras) and serves this on GET /api/ask/runs/:id as `extras`.
import { isBrowsableKind } from '../../shared/artifact-kinds.mjs';

/** Files listed under the result headline. */
export const RUN_CARD_TOP_FILES = 4;
/** Artifact chips; one more row tells the card to offer "All artifacts". */
export const RUN_CARD_ARTIFACTS = 6;
/** The pipeline statuses a run card shows a result region for (results.json is written on these paths only). */
export const RUN_CARD_FINISHED = Object.freeze(new Set(['done', 'stopped', 'error']));

/**
 * results.json → { filesChanged, additions, deletions, checks, topFiles:[{path, additions, deletions, status,
 * binary?, projectKey?}], checklist? }, or null without a summary object. filesChanged = filesNew + filesChanged ('D' rows
 * already count inside filesChanged — the Diff tab badge rule). checks = keyThingsToCheck (the Overview's "things
 * to check"). A workspace run reads every perProject entry and tags its files with the project key. Equal churn
 * sorts by path by code point (never localeCompare), so every OS lists the same four files.
 */
export function runCardResults(raw, { top = RUN_CARD_TOP_FILES } = {}) {
  if (!raw || typeof raw !== 'object' || !raw.summary || typeof raw.summary !== 'object') return null;
  const s = raw.summary;
  const rows = [];
  let checks = 0;
  const take = (r, projectKey) => {
    if (!r || typeof r !== 'object') return;
    for (const list of [r.newFiles, r.changedFiles]) {
      for (const f of Array.isArray(list) ? list : []) if (f && typeof f.path === 'string' && f.path) rows.push({ f, projectKey });
    }
    if (Array.isArray(r.keyThingsToCheck)) checks += r.keyThingsToCheck.length;
  };
  if (raw.perProject && typeof raw.perProject === 'object') {
    for (const [key, r] of Object.entries(raw.perProject)) take(r, key);
  } else {
    take(raw, null);
  }
  const churn = (x) => (Number(x.f.added) || 0) + (Number(x.f.removed) || 0);
  const topFiles = rows
    .sort((a, b) => churn(b) - churn(a) || (a.f.path < b.f.path ? -1 : a.f.path > b.f.path ? 1 : 0))
    .slice(0, Math.max(0, top))
    .map(({ f, projectKey }) => ({
      path: f.path, additions: Number(f.added) || 0, deletions: Number(f.removed) || 0, status: String(f.status || ''),
      ...(f.binary ? { binary: true } : {}), ...(projectKey ? { projectKey } : {}),
    }));
  // Spec D7: a shaped single-project run's checklist tally; workspace results have none.
  const cl = !raw.perProject && raw.checklist && typeof raw.checklist === 'object' ? raw.checklist : null;
  const num = (k) => Number(cl[k]) || 0;
  return {
    filesChanged: (Number(s.filesNew) || 0) + (Number(s.filesChanged) || 0),
    additions: Number(s.linesAdded) || 0,
    deletions: Number(s.linesRemoved) || 0,
    checks,
    topFiles,
    ...(cl ? { checklist: { met: num('met'), unmet: num('unmet'), na: num('na'), missing: num('missing'), total: num('total') } } : {}),
  };
}

/** The page of a run's artifact index that holds its LAST `n` browsable rows — the newest outputs (listRunArtifacts
 *  is oldest-first, so its first rows are the prompt and the plan). `rows` = the cheap listArtifacts rows
 *  ({kind, relPath}, no stat); returns {total, offset} for listRunArtifacts({limit: n, offset, browsableOnly}). */
export function lastArtifactsWindow(rows, n = RUN_CARD_ARTIFACTS) {
  const total = (Array.isArray(rows) ? rows : []).filter((a) => a && isBrowsableKind(a.kind)).length;
  return { total, offset: Math.max(0, total - Math.max(0, n)) };
}
