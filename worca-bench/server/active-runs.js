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
import { basename, dirname, join, relative, sep } from 'node:path';
import { srcHash } from './results-store.js';

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
 * worca-bench phase. The pipeline subprocess writes status.json; once it
 * reports `completed` but the work tree still exists, worca-bench is grading
 * (diff extraction + the grader), which is not a worca pipeline stage.
 */
function phaseOf(pipelineStatus) {
  if (pipelineStatus === 'failed' || pipelineStatus === 'error')
    return 'failed';
  if (pipelineStatus === 'completed') return 'grading';
  return 'running';
}

/** Derive { instance, rep } from the work-tree path under work/<profile>/. */
function instanceRep(profileWorkDir, statusFile) {
  const segs = relative(profileWorkDir, statusFile).split(sep);
  const instance = segs[0] || null;
  const m = (segs[1] || '').match(/^rep(\d+)$/);
  return { instance, rep: m ? Number(m[1]) : null };
}

/**
 * Read the template's per-stage enabled flags from the work tree (the
 * template-resolved truth, not the all-enabled base settings.json). Returns a
 * `{stage: enabled}` map, or null if it can't be resolved (then show all).
 * status.json lives at <repRoot>/.worca/runs/<id>/status.json.
 */
function enabledStageMap(statusFile, pipelineTemplate) {
  if (!pipelineTemplate) return null;
  const id = String(pipelineTemplate).replace(/^(builtin|project|user):/, '');
  const repRoot = dirname(dirname(dirname(dirname(statusFile))));
  const f = join(repRoot, '.claude', 'worca', 'templates', id, 'template.json');
  try {
    const stages = JSON.parse(readFileSync(f, 'utf8'))?.config?.stages;
    if (!stages || typeof stages !== 'object') return null;
    const map = {};
    for (const [k, v] of Object.entries(stages)) map[k] = v?.enabled !== false;
    return map;
  } catch {
    return null;
  }
}

/** Keep stages the template enables — plus any that actually ran/are running. */
function filterEnabledStages(stages, enabledMap) {
  if (!enabledMap) return stages;
  return stages.filter(
    (s) =>
      enabledMap[s.name] !== false ||
      s.skipped ||
      s.status === 'completed' ||
      s.status === 'in_progress',
  );
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
    const profileWorkDir = join(workRoot, profile);
    for (const file of findStatusFiles(profileWorkDir)) {
      let s;
      try {
        s = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        continue;
      }
      const runId = s.run_id || basename(join(file, '..'));
      const stages = filterEnabledStages(
        summarizeStages(s.stages),
        enabledStageMap(file, s.pipeline_template),
      );
      const pipelineStatus = s.pipeline_status || 'running';
      const { instance, rep } = instanceRep(profileWorkDir, file);
      out.push({
        profile,
        src: srcHash(dir),
        instance,
        rep,
        run_id: runId,
        kind: String(runId).startsWith('canary') ? 'canary' : 'rep',
        pipeline_status: pipelineStatus,
        phase: phaseOf(pipelineStatus),
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

/** Map `<src>::<profile>` -> its most-recently-updated active run (card badges). */
export function activeByProfile(active) {
  const map = new Map();
  for (const run of active) {
    const key = `${run.src}::${run.profile}`;
    const cur = map.get(key);
    if (!cur || (run._mtime || 0) > (cur._mtime || 0)) {
      map.set(key, run);
    }
  }
  return map;
}
