// server/active-runs.js
//
// Live run discovery. A results.jsonl row only appears once a rep COMPLETES, so
// to reflect in-flight progress the dashboard reads worca's status.json from the
// transient per-rep work tree:
//
//   <target>/work/<profile>/<instance|__canary__>/rep<N>/.../.worca/runs/<run_id>/status.json
//
// Each status.json carries the pipeline status + per-stage progress (agent, model,
// status). The work tree is removed when the rep finishes, so "a status.json under
// work/" IS the live window.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

const STATUS_SEG = `${'.worca'}/runs`; // status.json lives at .worca/runs/<id>/status.json

function safeReaddir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// Recursively collect status.json files nested under a `.worca/runs/<id>/` path.
function findStatusFiles(root, maxDepth = 7) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    for (const e of safeReaddir(dir)) {
      if (!e.isDirectory()) continue;
      const child = join(dir, e.name);
      const candidate = join(child, 'status.json');
      if (
        child.replaceAll('\\', '/').includes(STATUS_SEG) &&
        existsSync(candidate)
      ) {
        found.push(candidate);
      }
      walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return found;
}

/** Ordered per-stage summary. status.json `stages` preserves insertion order. */
function summarizeStages(stages) {
  if (!stages || typeof stages !== 'object') return [];
  return Object.entries(stages).map(([name, s]) => ({
    name,
    status: s?.status || 'pending',
    agent: s?.agent || null,
    model: s?.model_alias || s?.model || null,
    skipped: !!s?.skipped,
  }));
}

/** The stage currently in progress, else the last completed one. */
function currentStage(stageList) {
  const running = stageList.find((s) => s.status === 'in_progress');
  if (running) return running.name;
  const done = stageList.filter((s) => s.status === 'completed');
  return done.length ? done[done.length - 1].name : null;
}

/**
 * Discover active (in-flight) runs under one target dir.
 *
 * @param {string} dir
 * @returns {Array<{profile, run_id, kind, pipeline_status, stage, stages, started_at}>}
 */
export function discoverActive(dir) {
  const workRoot = join(dir, 'work');
  if (!existsSync(workRoot)) return [];
  const out = [];
  for (const p of safeReaddir(workRoot)) {
    if (!p.isDirectory()) continue;
    const profile = p.name;
    for (const file of findStatusFiles(join(workRoot, profile))) {
      let s;
      try {
        s = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        continue;
      }
      const runId = s.run_id || basename(join(file, '..'));
      const stages = summarizeStages(s.stages);
      out.push({
        profile,
        run_id: runId,
        kind: String(runId).startsWith('canary') ? 'canary' : 'rep',
        pipeline_status: s.pipeline_status || 'running',
        stage: currentStage(stages),
        stages,
        started_at: s.started_at || null,
        _mtime: _safeMtime(file),
      });
    }
  }
  return out;
}

function _safeMtime(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/** Discover active runs across several dirs (deduped by dir). */
export function discoverActiveMulti(dirs) {
  const out = [];
  const seen = new Set();
  for (const dir of dirs) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    out.push(...discoverActive(dir));
  }
  return out;
}

/** Map profile name -> its most-recently-updated active run (for card badges). */
export function activeByProfile(active) {
  const map = new Map();
  for (const run of active) {
    const cur = map.get(run.profile);
    if (!cur || (run._mtime || 0) > (cur._mtime || 0)) {
      map.set(run.profile, run);
    }
  }
  return map;
}
