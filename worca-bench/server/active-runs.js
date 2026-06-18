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

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { srcHash } from './results-store.js';

const STATUS_SEG = `${'.worca'}/runs`; // status.json lives at .worca/runs/<id>/status.json

// Authoritative bead progress comes from the run's own beads DB (the coordinator
// creates ALL beads up front; status.json iterations only ever show the ones the
// implementer has *dispatched*). We shell out to `bd stats --json` in the run
// worktree. Cached briefly per worktree so the dashboard's overlapping polls
// (/api/active + /api/profiles) don't spawn `bd` twice per tick.
const _BEAD_TTL_MS = 4000;
const _beadCache = new Map(); // repRoot -> { ts, value }

/**
 * { done, total } beads for the run rooted at `repRoot` (the dir holding
 * `.beads/`), or null when there's no beads DB, `bd` is unavailable, or the DB
 * is empty. `done` = closed issues, `total` = all issues.
 */
function beadCounts(repRoot, now = Date.now()) {
  const cached = _beadCache.get(repRoot);
  if (cached && now - cached.ts < _BEAD_TTL_MS) return cached.value;
  let value = null;
  if (existsSync(join(repRoot, '.beads', 'beads.db'))) {
    try {
      const out = execFileSync('bd', ['stats', '--json'], {
        cwd: repRoot,
        timeout: 2500,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const sum = JSON.parse(out)?.summary;
      const total = Number(sum?.total_issues);
      if (Number.isInteger(total) && total > 0) {
        value = { done: Number(sum?.closed_issues) || 0, total };
      }
    } catch {
      value = null; // bd missing / errored / timed out — show no count, not a wrong one
    }
  }
  _beadCache.set(repRoot, { ts: now, value });
  return value;
}

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
  return Object.entries(stages).map(([name, s]) => {
    const entry = {
      name,
      status: s?.status || 'pending',
      agent: s?.agent || null,
      model: s?.model_alias || s?.model || null,
      skipped: !!s?.skipped,
    };
    // How many times the stage ran (a loop-back re-runs the stage). Prefer the
    // explicit `iteration` counter, else the iterations array length. Surfaced
    // only when > 1 so single-pass stages stay clean.
    const iters =
      Number.isInteger(s?.iteration) && s.iteration > 0
        ? s.iteration
        : Array.isArray(s?.iterations)
          ? s.iterations.length
          : 0;
    if (iters > 1) entry.iters = iters;
    return entry;
  });
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

// Pipeline statuses that mean a run is genuinely in-flight — or, for `completed`,
// that worca-bench is still grading it (the work tree lingers until the grader
// finishes, then it's removed). Anything else is terminal: interrupted/cancelled
// (stopped), failed/setup_failed/unrecoverable (errored). A terminal run's work
// tree can persist until cleanup, but it must NOT be reported as active — else a
// stopped/crashed run leaves a stale "running" card in the live block. Mirrors
// the dead-run reconciliation discoverRegrades() does via pidAlive().
const ACTIVE_PIPELINE_STATUS = new Set([
  'pending',
  'running',
  'resuming',
  'paused',
  'completed',
]);

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
      const pipelineStatus = s.pipeline_status || 'running';
      // Skip terminal runs (stopped/failed) whose work tree lingers — they are
      // not active and would otherwise render as a stale live card.
      if (!ACTIVE_PIPELINE_STATUS.has(pipelineStatus)) continue;
      const runId = s.run_id || basename(join(file, '..'));
      const stages = filterEnabledStages(
        summarizeStages(s.stages),
        enabledStageMap(file, s.pipeline_template),
      );
      // Authoritative bead progress (closed/total) from the run's beads DB,
      // surfaced on the implementer chip. repRoot is <.../rep<N>/...> holding
      // .beads/ — the dir 4 levels up from .worca/runs/<id>/status.json.
      const implementStage = stages.find((x) => x.name === 'implement');
      if (implementStage) {
        const beads = beadCounts(dirname(dirname(dirname(dirname(file)))));
        if (beads) implementStage.beads = beads;
      }
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

/** True if `pid` names a live process we can see (EPERM = alive but not ours). */
function pidAlive(pid) {
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/**
 * Discover regrade sweeps under one target dir from their heartbeat files
 * (<dir>/runs/<profile>/regrade-status.json). A `running` heartbeat whose pid is
 * gone is reclassified `ended` so a crashed sweep never shows as live forever.
 *
 * @returns {Array<{profile, src, mode, total, done, current, counts, status, active, started_at, updated_at, pid}>}
 */
export function discoverRegrades(dir) {
  const runsRoot = join(dir, 'runs');
  if (!existsSync(runsRoot)) return [];
  const out = [];
  for (const p of safeReaddir(runsRoot)) {
    if (!p.isDirectory()) continue;
    const f = join(runsRoot, p.name, 'regrade-status.json');
    if (!existsSync(f)) continue;
    let s;
    try {
      s = JSON.parse(readFileSync(f, 'utf8'));
    } catch {
      continue;
    }
    s.src = srcHash(dir);
    if (s.status === 'running' && !pidAlive(s.pid)) s.status = 'ended';
    s.active = s.status === 'running';
    out.push(s);
  }
  return out;
}

/** Discover regrade sweeps across several dirs (deduped by dir). */
export function discoverRegradesMulti(dirs) {
  const out = [];
  const seen = new Set();
  for (const dir of dirs) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    out.push(...discoverRegrades(dir));
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
