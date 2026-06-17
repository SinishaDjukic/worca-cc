// server/process-manager.js
//
// Fire-and-forget launcher for the worca-bench Python runner. Mirrors the
// pattern in worca-ui/server/process-manager.js: spawn detached, capture
// stderr for diagnostics, resolve with {pid} once the child has been handed
// off, and reject under a hard cap so a hung launch never blocks the request
// forever. The benchmark run itself is long-lived — this only kicks it off.

import { spawn } from 'node:child_process';

const HARD_CAP_MS = 180000;

// Grader credentials the dashboard may forward from the browser. The browser is
// the only at-rest store for these — they reach the runner through the spawned
// subprocess's *environment* (never argv, so they stay out of `ps`), where the
// Python side's collect_secret_env() picks them up. Strictly allowlisted so a
// crafted request can't inject an arbitrary env var into the child.
export const GRADER_SECRET_KEYS = [
  'SWEBENCH_API_KEY',
  'MODAL_TOKEN_ID',
  'MODAL_TOKEN_SECRET',
];

/** Keep only allowlisted, non-empty string secrets — safe to merge into env. */
function sanitizeSecrets(secrets) {
  const out = {};
  if (secrets && typeof secrets === 'object') {
    for (const k of GRADER_SECRET_KEYS) {
      const v = secrets[k];
      if (typeof v === 'string' && v.trim()) out[k] = v;
    }
  }
  return out;
}

/**
 * Spawn `python3 -m worca_bench.cli run --profile <name> --target-dir <dir>`
 * detached and return its pid. The grandchild owns its own stdio/logging; we
 * only keep stderr open briefly to surface an immediate spawn failure.
 *
 * @param {object} opts
 * @param {string} opts.profile     profile name to run
 * @param {string} opts.targetDir   results target directory
 * @param {string} [opts.profilesDir]  extra dir to search for the profile YAML
 *        (so a profile authored in a configured, non-primary dir is findable)
 * @param {number} [opts.reps]          per-run override of the profile's reps
 * @param {number} [opts.maxInstances]  cap the instance count for this run
 * @param {number} [opts.maxParallel]   override pipeline parallelism (concurrency.worca)
 * @param {boolean} [opts.noCanary]     skip the per-template canary preflight
 * @param {string} [opts.cacheDir]      benchmark cache dir (HF datasets / mirrors)
 * @param {string} [opts.graphify]      enable graphify in this mode (structural|full)
 * @param {string} [opts.codeReviewGraph]  enable code-review-graph in this mode
 * @param {object} [opts.secrets]       grader credentials (allowlisted) merged into the child env
 * @param {(args: string[], options: object) => import('node:child_process').ChildProcess} [opts._spawn]
 *        injectable spawn for tests
 * @returns {Promise<{pid: number}>}
 */
export function runBenchmark({
  profile,
  targetDir,
  profilesDir,
  reps,
  maxInstances,
  maxParallel,
  noCanary,
  cacheDir,
  graphify,
  codeReviewGraph,
  secrets,
  _spawn = spawn,
} = {}) {
  if (!profile) {
    return Promise.reject(new Error('profile is required'));
  }
  const args = [
    '-m',
    'worca_bench.cli',
    'run',
    '--profile',
    profile,
    '--target-dir',
    targetDir,
  ];
  if (profilesDir) {
    args.push('--profiles-dir', profilesDir);
  }
  if (Number.isInteger(reps) && reps >= 1) {
    args.push('--reps', String(reps));
  }
  if (Number.isInteger(maxInstances) && maxInstances >= 1) {
    args.push('--max-instances', String(maxInstances));
  }
  if (Number.isInteger(maxParallel) && maxParallel >= 1) {
    args.push('--max-parallel', String(maxParallel));
  }
  if (noCanary) {
    args.push('--no-canary');
  }
  if (cacheDir) {
    args.push('--cache-dir', cacheDir);
  }
  if (graphify) {
    args.push('--graphify', String(graphify));
  }
  if (codeReviewGraph) {
    args.push('--code-review-graph', String(codeReviewGraph));
  }

  return _launchDetached(args, {
    _spawn,
    label: 'benchmark',
    secrets: sanitizeSecrets(secrets),
  });
}

/**
 * Spawn `python3 -m worca_bench.cli regrade …` detached and return its pid.
 * Re-grades a profile's saved diffs without re-running the pipeline.
 *
 * @param {object} opts
 * @param {string} opts.profile      profile name to re-grade
 * @param {string} opts.targetDir    results target directory
 * @param {string} [opts.profilesDir]  extra dir to search for the profile YAML
 * @param {string} [opts.instance]   limit to a single instance id
 * @param {string} [opts.mode]       grade backend (sb-cli|local-docker|modal|stub)
 * @param {boolean} [opts.onlyErrors]  re-grade only rows currently marked error
 * @param {object} [opts.secrets]     grader credentials (allowlisted) merged into the child env
 * @param {(args: string[], options: object) => import('node:child_process').ChildProcess} [opts._spawn]
 * @returns {Promise<{pid: number}>}
 */
export function runRegrade({
  profile,
  targetDir,
  profilesDir,
  instance,
  mode,
  onlyErrors,
  secrets,
  _spawn = spawn,
} = {}) {
  if (!profile) {
    return Promise.reject(new Error('profile is required'));
  }
  const args = [
    '-m',
    'worca_bench.cli',
    'regrade',
    '--profile',
    profile,
    '--target-dir',
    targetDir,
  ];
  if (profilesDir) {
    args.push('--profiles-dir', profilesDir);
  }
  if (mode) {
    args.push('--mode', String(mode));
  }
  if (instance) {
    args.push('--instance', String(instance));
  }
  if (onlyErrors) {
    args.push('--only-errors');
  }
  return _launchDetached(args, {
    _spawn,
    label: 'regrade',
    secrets: sanitizeSecrets(secrets),
  });
}

/**
 * Shared detached-spawn for the long-lived CLI runners: spawn `python3 <args>`,
 * resolve `{pid}` as soon as the child is handed off (do NOT wait for exit), and
 * reject on an early spawn error/exit or the hard-cap timeout.
 */
function _launchDetached(
  args,
  { _spawn = spawn, label = 'process', secrets } = {},
) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = _spawn('python3', args, {
        detached: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        // Browser-forwarded grader secrets ride in the env, never argv.
        env: { ...process.env, ...(secrets || {}) },
      });
    } catch (err) {
      reject(new Error(`Failed to start ${label}: ${err.message}`));
      return;
    }

    let settled = false;
    let stderr = '';
    const STDERR_CAP = 8192;

    const hardCap = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.removeAllListeners?.('error');
      child.removeAllListeners?.('exit');
      const err = new Error(
        `${label} launcher did not finish within 180s — aborting launch`,
      );
      err.code = 'spawn_timeout';
      reject(err);
    }, HARD_CAP_MS);
    hardCap.unref?.();

    if (child.stderr) {
      child.stderr.on('data', (d) => {
        if (stderr.length < STDERR_CAP) stderr += d.toString();
      });
    }

    child.on('error', (spawnErr) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardCap);
      const err = new Error(`Failed to start ${label}: ${spawnErr.message}`);
      err.code = 'spawn_error';
      reject(err);
    });

    // The runner is long-lived. Resolve as soon as we have a live pid and the
    // child has been detached — we do NOT wait for exit (that's the whole run).
    if (child.pid) {
      settled = true;
      clearTimeout(hardCap);
      child.unref?.();
      resolve({ pid: child.pid });
    } else {
      // No pid synchronously available — wait for an early error/exit instead.
      child.on('exit', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(hardCap);
        const err = new Error(
          `${label} failed to start (exit code ${code})${stderr.trim() ? `:\n${stderr.trim()}` : ''}`,
        );
        err.code = 'spawn_error';
        reject(err);
      });
    }
  });
}
