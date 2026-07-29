// src/core/results.mjs
// Layer 1 (mechanical) results view: pure deterministic assembler + git-backed
// builder + persistence/read accessors. No model call in this path — rebuilding
// assembleResults on the same patch + reviews yields byte-identical JSON.
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { recordArtifact, resolvePipelineId, readPipelineExtras } from './artifacts.mjs';

const NEW_STATUS = new Set(['A', 'C']);

export const RESULTS_FILE = 'results.json';
export const DIFF_PATCH_FILE = 'diff-patch.patch';
export const OVERVIEW_FILE = 'overview.json';

/** Bucket name-status rows into new/changed and sum line counts from numstat. */
export function bucketFiles(nameStatus, numstat) {
  const newFiles = [];
  const changedFiles = [];
  let linesAdded = 0, linesRemoved = 0, filesDeleted = 0;
  for (const row of nameStatus) {
    const n = numstat.get(row.path) || { added: 0, removed: 0, binary: false };
    linesAdded += n.added; linesRemoved += n.removed;
    if (row.status === 'D') filesDeleted += 1;
    const base = { path: row.path, status: row.status };
    if (!n.binary) { base.added = n.added; base.removed = n.removed; } else base.binary = true;
    if (NEW_STATUS.has(row.status)) {
      newFiles.push(base);
    } else {
      if (row.from) base.from = row.from;
      base.issues = [];
      changedFiles.push(base);
    }
  }
  newFiles.sort((a, b) => a.path.localeCompare(b.path));
  changedFiles.sort((a, b) => a.path.localeCompare(b.path));
  return {
    newFiles,
    changedFiles,
    counts: {
      filesNew: newFiles.length,
      filesChanged: changedFiles.length,
      filesDeleted,
      linesAdded,
      linesRemoved,
    },
  };
}

/** Keep only the highest-cycle review row per kind. */
function latestPerKind(reviews) {
  const byKind = new Map();
  for (const r of reviews) {
    const cur = byKind.get(r.kind);
    if (!cur || r.cycle > cur.cycle) byKind.set(r.kind, r);
  }
  return [...byKind.values()];
}

const SEV_RANK = { critical: 0, major: 1 };

/** Critical+major issues, latest cycle per kind, deduped by severity|title, sorted. */
export function selectKeyChecks(reviews) {
  const latest = latestPerKind(reviews);
  const seen = new Map(); // key -> check
  let seq = 0;
  for (const row of latest) {
    for (const iss of row.issues || []) {
      if (iss.severity !== 'critical' && iss.severity !== 'major') continue;
      const key = `${iss.severity}|${(iss.title || '').toLowerCase()}`;
      const existing = seen.get(key);
      if (existing) {
        if (!existing.kind.split(',').includes(row.kind)) existing.kind += `,${row.kind}`;
        continue;
      }
      seen.set(key, {
        id: `check-${seq++}`,
        severity: iss.severity,
        title: iss.title,
        detail: iss.detail,
        location: iss.location,
        kind: row.kind,
        cycle: row.cycle,
      });
    }
  }
  return [...seen.values()].sort((a, b) =>
    (SEV_RANK[a.severity] - SEV_RANK[b.severity]) ||
    (Number(a.id.slice(6)) - Number(b.id.slice(6))));
}

/** Minor+suggestion issues from the latest cycle per kind. */
export function splitNitpicks(reviews) {
  const out = [];
  for (const row of latestPerKind(reviews)) {
    for (const iss of row.issues || []) {
      if (iss.severity === 'minor' || iss.severity === 'suggestion') {
        out.push({ severity: iss.severity, title: iss.title, kind: row.kind });
      }
    }
  }
  return out;
}

function basename(p) { const i = p.lastIndexOf('/'); return i < 0 ? p : p.slice(i + 1); }

/** Best-effort substring link of checks to changed/new files. Mutates both. */
export function linkIssues(checks, files) {
  const all = [...files.changedFiles, ...files.newFiles];
  for (const c of checks) {
    if (!c.location) continue;
    const hit = all.find((f) => c.location.includes(f.path) || c.location.includes(basename(f.path)));
    if (hit) {
      c.file = hit.path;
      if (Array.isArray(hit.issues)) hit.issues.push(c.id);
    }
  }
}

/** Build the full single-project results object. Pure + deterministic. */
export function assembleResults({ nameStatus, numstat, reviews }) {
  const files = bucketFiles(nameStatus, numstat);
  const keyThingsToCheck = selectKeyChecks(reviews);
  const nitpicks = splitNitpicks(reviews);
  linkIssues(keyThingsToCheck, files);
  return {
    summary: {
      ...files.counts,
      blockingIssues: keyThingsToCheck.length,
      nitpicks: nitpicks.length,
    },
    newFiles: files.newFiles,
    changedFiles: files.changedFiles,
    keyThingsToCheck,
    nitpicks,
  };
}

/** Map [{projectKey, results}] -> { <projectKey>: results }. */
export function buildPerProject(members) {
  const out = {};
  for (const m of members) out[m.projectKey] = m.results;
  return out;
}

/** Sum member summaries into one workspace-level summary. */
export function rollupSummary(perProject) {
  const keys = ['filesNew', 'filesChanged', 'filesDeleted', 'linesAdded', 'linesRemoved', 'blockingIssues', 'nitpicks'];
  const s = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const r of Object.values(perProject)) for (const k of keys) s[k] += (r.summary?.[k] || 0);
  return s;
}

/** Write results.json into the pipeline dir and index it (best-effort index). */
export async function persistResults(pipelineDir, results) {
  if (!pipelineDir || !results) return;
  await writeFile(join(pipelineDir, RESULTS_FILE), JSON.stringify(results, null, 2));
  const id = resolvePipelineId(pipelineDir);
  if (id) recordArtifact(id, 'results', RESULTS_FILE);
}

/** Write the unified diff patch into the pipeline dir and index it. */
export async function persistDiffPatch(pipelineDir, patch) {
  if (!pipelineDir || patch == null) return;
  await writeFile(join(pipelineDir, DIFF_PATCH_FILE), String(patch));
  const id = resolvePipelineId(pipelineDir);
  if (id) recordArtifact(id, 'diff-patch', DIFF_PATCH_FILE);
}

/**
 * Spec §6 shared context bundle for a finished run — the substrate for the
 * overview agent and a future Q&A agent. `dir` is the absolute pipeline dir.
 */
export async function readRunContextBundle(dir, pipelineId) {
  const read = async (f) => { try { return await readFile(join(dir, f), 'utf8'); } catch { return null; } };
  const resultsTxt = await read(RESULTS_FILE);
  return {
    diffPatch: await read(DIFF_PATCH_FILE),
    results: resultsTxt ? JSON.parse(resultsTxt) : null,
    reviews: readPipelineExtras(pipelineId).reviews || [],
    audit: null, // audit markdown is rebuilt by buildAuditMarkdown at the API layer
  };
}
