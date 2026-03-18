/**
 * Pipeline process lifecycle management.
 * Handles starting, stopping, and restarting pipeline processes.
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

/**
 * Check if a pipeline is currently running.
 * @param {string} worcaDir - Path to .worca directory
 * @returns {{ pid: number } | null}
 */
export function getRunningPid(worcaDir) {
  const pidPath = join(worcaDir, 'pipeline.pid');
  if (!existsSync(pidPath)) return null;
  try {
    const pid = parseInt(readFileSync(pidPath, 'utf8').trim(), 10);
    if (isNaN(pid) || pid <= 0) {
      try { unlinkSync(pidPath); } catch { /* ignore */ }
      return null;
    }
    process.kill(pid, 0); // throws if dead
    return { pid };
  } catch {
    // Stale PID file — clean up
    try { unlinkSync(pidPath); } catch { /* ignore */ }
    return null;
  }
}

/**
 * Start a new pipeline run.
 * @param {string} worcaDir - Path to .worca directory
 * @param {{ inputType?: string, inputValue?: string, msize?: number, mloops?: number, planFile?: string, resume?: boolean, projectRoot?: string }} opts
 * @returns {Promise<{ pid: number }>}
 */
export async function startPipeline(worcaDir, opts = {}) {
  const running = getRunningPid(worcaDir);
  if (running) {
    const err = new Error(`Pipeline already running (PID ${running.pid})`);
    err.code = 'already_running';
    throw err;
  }

  const cwd = opts.projectRoot || process.cwd();
  const scriptPath = join(cwd, '.claude/scripts/run_pipeline.py');
  if (!existsSync(scriptPath)) {
    const err = new Error(`Pipeline script not found at ${scriptPath}`);
    err.code = 'script_not_found';
    throw err;
  }

  const args = ['.claude/scripts/run_pipeline.py'];

  if (opts.resume) {
    args.push('--resume');
  } else if (opts.sourceType !== undefined) {
    // New format: separate source and prompt args
    if (opts.sourceType === 'source') args.push('--source', opts.sourceValue);
    else if (opts.sourceType === 'spec') args.push('--spec', opts.sourceValue);
    if (opts.prompt) args.push('--prompt', opts.prompt);
  } else {
    // Legacy format: inputType/inputValue
    const flag = opts.inputType === 'source' ? '--source'
      : opts.inputType === 'spec' ? '--spec'
      : '--prompt';
    args.push(flag, opts.inputValue);
  }

  if (opts.msize && opts.msize > 1) {
    args.push('--msize', String(opts.msize));
  }
  if (opts.mloops && opts.mloops > 1) {
    args.push('--mloops', String(opts.mloops));
  }
  if (opts.planFile) {
    args.push('--plan', opts.planFile);
  }
  if (opts.branch) {
    args.push('--branch', opts.branch);
  }

  const env = { ...process.env };
  delete env.CLAUDECODE;

  return new Promise((resolve, reject) => {
    const child = spawn('python', args, {
      detached: true,
      stdio: 'ignore',
      cwd,
      env,
    });

    const timeout = setTimeout(() => {
      cleanup();
      child.unref();
      resolve({ pid: child.pid });
    }, 2000);

    function cleanup() {
      clearTimeout(timeout);
      child.removeAllListeners('error');
      child.removeAllListeners('exit');
    }

    child.on('error', (spawnErr) => {
      cleanup();
      const err = new Error(`Failed to start pipeline: ${spawnErr.message}`);
      err.code = 'spawn_error';
      reject(err);
    });

    child.on('exit', (code, signal) => {
      cleanup();
      if (code !== null && code !== 0) {
        const err = new Error(`Pipeline exited immediately with code ${code}`);
        err.code = 'spawn_error';
        reject(err);
      } else if (signal) {
        const err = new Error(`Pipeline killed by signal ${signal}`);
        err.code = 'spawn_error';
        reject(err);
      }
      // code === 0 or code === null (still running) — resolve
      child.unref();
      resolve({ pid: child.pid });
    });
  });
}

/**
 * Stop a running pipeline.
 * @param {string} worcaDir - Path to .worca directory
 * @returns {{ pid: number, stopped: boolean }}
 */
export function stopPipeline(worcaDir) {
  let pid = null;
  const pidPath = join(worcaDir, 'pipeline.pid');

  // Try PID file first
  if (existsSync(pidPath)) {
    try {
      pid = parseInt(readFileSync(pidPath, 'utf8').trim(), 10);
      process.kill(pid, 0); // verify alive
    } catch {
      try { unlinkSync(pidPath); } catch { /* ignore */ }
      pid = null;
    }
  }

  // Fallback: find by command line
  if (!pid) {
    try {
      const out = execFileSync('pgrep', ['-f', 'run_pipeline\\.py'], { encoding: 'utf8', timeout: 3000 });
      const pids = out.trim().split('\n').map(s => parseInt(s, 10)).filter(n => n > 0);
      if (pids.length > 0) pid = pids[0];
    } catch { /* no matching process */ }
  }

  if (!pid) {
    const err = new Error('No running pipeline found');
    err.code = 'not_running';
    throw err;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (e) {
    try { unlinkSync(pidPath); } catch { /* ignore */ }
    const err = new Error(`Failed to stop pipeline: ${e.message}`);
    err.code = 'not_running';
    throw err;
  }

  // Watchdog: SIGKILL after 10s if still alive
  const watchdog = setTimeout(() => {
    try {
      process.kill(pid, 0); // check alive
      process.kill(pid, 'SIGKILL');
    } catch { /* already dead */ }
  }, 10000);
  watchdog.unref();

  // Clean up PID file
  try { unlinkSync(pidPath); } catch { /* ignore */ }

  return { pid, stopped: true };
}

/**
 * Restart a failed stage by resetting it and spawning with --resume.
 * @param {string} worcaDir - Path to .worca directory
 * @param {string} stageKey - The stage key to restart
 * @param {{ projectRoot?: string }} opts
 * @returns {Promise<{ pid: number, stage: string }>}
 */
export async function restartStage(worcaDir, stageKey, opts = {}) {
  const running = getRunningPid(worcaDir);
  if (running) {
    const err = new Error(`Pipeline already running (PID ${running.pid})`);
    err.code = 'already_running';
    throw err;
  }

  const cwd = opts.projectRoot || process.cwd();
  const scriptPath = join(cwd, '.claude/scripts/run_pipeline.py');
  if (!existsSync(scriptPath)) {
    const err = new Error(`Pipeline script not found at ${scriptPath}`);
    err.code = 'script_not_found';
    throw err;
  }

  // Find status.json — check active_run first, then legacy
  let statusPath = null;
  const activeRunPath = join(worcaDir, 'active_run');
  if (existsSync(activeRunPath)) {
    try {
      const runId = readFileSync(activeRunPath, 'utf8').trim();
      const candidate = join(worcaDir, 'runs', runId, 'status.json');
      if (existsSync(candidate)) statusPath = candidate;
    } catch { /* ignore */ }
  }
  if (!statusPath) {
    const legacy = join(worcaDir, 'status.json');
    if (existsSync(legacy)) statusPath = legacy;
  }

  if (!statusPath) {
    const err = new Error('No status.json found');
    err.code = 'no_status';
    throw err;
  }

  const status = JSON.parse(readFileSync(statusPath, 'utf8'));

  if (!status.stages || !status.stages[stageKey]) {
    const err = new Error(`Stage "${stageKey}" not found`);
    err.code = 'stage_not_found';
    throw err;
  }

  if (status.stages[stageKey].status !== 'error') {
    const err = new Error(`Stage "${stageKey}" is not in error state (current: ${status.stages[stageKey].status})`);
    err.code = 'stage_not_error';
    throw err;
  }

  // Reset the stage
  status.stages[stageKey].status = 'pending';
  delete status.stages[stageKey].error;
  delete status.stages[stageKey].completed_at;
  writeFileSync(statusPath, JSON.stringify(status, null, 2) + '\n', 'utf8');

  // Spawn with --resume
  const env = { ...process.env };
  delete env.CLAUDECODE;

  return new Promise((resolve, reject) => {
    const child = spawn('python', ['.claude/scripts/run_pipeline.py', '--resume'], {
      detached: true,
      stdio: 'ignore',
      cwd,
      env,
    });

    const timeout = setTimeout(() => {
      cleanup();
      child.unref();
      resolve({ pid: child.pid, stage: stageKey });
    }, 2000);

    function cleanup() {
      clearTimeout(timeout);
      child.removeAllListeners('error');
      child.removeAllListeners('exit');
    }

    child.on('error', (spawnErr) => {
      cleanup();
      const err = new Error(`Failed to restart stage: ${spawnErr.message}`);
      err.code = 'spawn_error';
      reject(err);
    });

    child.on('exit', (code, signal) => {
      cleanup();
      if (code !== null && code !== 0) {
        const err = new Error(`Pipeline exited immediately with code ${code}`);
        err.code = 'spawn_error';
        reject(err);
      } else if (signal) {
        const err = new Error(`Pipeline killed by signal ${signal}`);
        err.code = 'spawn_error';
        reject(err);
      }
      child.unref();
      resolve({ pid: child.pid, stage: stageKey });
    });
  });
}
