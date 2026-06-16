// server/process-manager.js
//
// Fire-and-forget launcher for the worca-bench Python runner. Mirrors the
// pattern in worca-ui/server/process-manager.js: spawn detached, capture
// stderr for diagnostics, resolve with {pid} once the child has been handed
// off, and reject under a hard cap so a hung launch never blocks the request
// forever. The benchmark run itself is long-lived — this only kicks it off.

import { spawn } from 'node:child_process';

const HARD_CAP_MS = 180000;

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
 * @param {(args: string[], options: object) => import('node:child_process').ChildProcess} [opts._spawn]
 *        injectable spawn for tests
 * @returns {Promise<{pid: number}>}
 */
export function runBenchmark({
  profile,
  targetDir,
  profilesDir,
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

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = _spawn('python3', args, {
        detached: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...process.env },
      });
    } catch (err) {
      reject(new Error(`Failed to start benchmark: ${err.message}`));
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
        'Benchmark launcher did not finish within 180s — aborting launch',
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
      const err = new Error(`Failed to start benchmark: ${spawnErr.message}`);
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
          `Benchmark failed to start (exit code ${code})${stderr.trim() ? `:\n${stderr.trim()}` : ''}`,
        );
        err.code = 'spawn_error';
        reject(err);
      });
    }
  });
}
