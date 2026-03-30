/**
 * Pipeline process lifecycle management.
 * Handles starting, stopping, and restarting pipeline processes.
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Byte threshold — must match claude_cli.py _ARG_INLINE_LIMIT */
const ARG_INLINE_LIMIT = 128 * 1024;

/**
 * Write content to a temp file with restricted permissions (0o600) and return its path.
 * Used to avoid E2BIG when passing large prompts as CLI arguments.
 * @param {string} content
 * @returns {string} path to the temp file
 */
function writePromptFile(content) {
  const name = `worca_prompt_${randomBytes(8).toString('hex')}.md`;
  const filePath = join(tmpdir(), name);
  const fd = openSync(filePath, 'w', 0o600);
  try {
    writeSync(fd, content, 0, 'utf8');
  } finally {
    closeSync(fd);
  }
  return filePath;
}

/**
 * Try to delete a temp prompt file. Silently ignores errors.
 * @param {string|null} filePath
 */
function cleanupPromptFile(filePath) {
  if (!filePath) return;
  try {
    unlinkSync(filePath);
  } catch {
    /* ignore */
  }
}

/**
 * Pipeline process lifecycle manager.
 * Encapsulates all process management for a single project's .worca directory.
 */
export class ProcessManager {
  /**
   * @param {{ worcaDir: string, projectRoot?: string }} options
   */
  constructor({ worcaDir, projectRoot }) {
    this.worcaDir = worcaDir;
    this.projectRoot = projectRoot || process.cwd();
  }

  /**
   * Check if a pipeline is currently running.
   * @returns {{ pid: number } | null}
   */
  getRunningPid() {
    const pidPath = join(this.worcaDir, 'pipeline.pid');
    if (!existsSync(pidPath)) return null;
    try {
      const pid = parseInt(readFileSync(pidPath, 'utf8').trim(), 10);
      if (Number.isNaN(pid) || pid <= 0) {
        try {
          unlinkSync(pidPath);
        } catch {
          /* ignore */
        }
        return null;
      }
      process.kill(pid, 0); // throws if dead
      return { pid };
    } catch {
      // Stale PID file — clean up
      try {
        unlinkSync(pidPath);
      } catch {
        /* ignore */
      }
      return null;
    }
  }

  /**
   * Reconcile stale "running" status when the pipeline process is dead.
   * Checks the active run's status.json — if pipeline_status is "running"
   * but no process is alive, transitions to "failed" with stop_reason="stale".
   * Preserves any existing stop_reason (e.g. "signal" set by Layer 1).
   *
   * @returns {boolean} true if status was fixed
   */
  reconcileStatus() {
    const running = this.getRunningPid();
    if (running) return false; // process is alive, nothing to fix

    const activeRunPath = join(this.worcaDir, 'active_run');
    if (!existsSync(activeRunPath)) return false;

    let runId;
    try {
      runId = readFileSync(activeRunPath, 'utf8').trim();
    } catch {
      return false;
    }
    if (!runId) return false;

    const statusPath = join(this.worcaDir, 'runs', runId, 'status.json');
    if (!existsSync(statusPath)) return false;

    let status;
    try {
      status = JSON.parse(readFileSync(statusPath, 'utf8'));
    } catch {
      return false;
    }

    if (status.pipeline_status !== 'running') return false;

    status.pipeline_status = 'failed';
    if (!status.stop_reason) {
      status.stop_reason = 'stale';
    }
    try {
      writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
    } catch {
      return false;
    }

    return true;
  }

  /**
   * Start a new pipeline run.
   * @param {{ inputType?: string, inputValue?: string, msize?: number, mloops?: number, planFile?: string, resume?: boolean, projectRoot?: string }} opts
   * @returns {Promise<{ pid: number }>}
   */
  async startPipeline(opts = {}) {
    const cwd = opts.projectRoot || this.projectRoot;
    const scriptPath = join(cwd, '.claude/scripts/run_pipeline.py');
    if (!existsSync(scriptPath)) {
      const err = new Error(`Pipeline script not found at ${scriptPath}`);
      err.code = 'script_not_found';
      throw err;
    }

    const args = ['.claude/scripts/run_pipeline.py'];
    let promptFilePath = null; // track for cleanup on spawn failure

    if (opts.resume) {
      args.push('--resume');
      if (opts.runId) {
        args.push('--status-dir', join(this.worcaDir, 'runs', opts.runId));
      }
    } else if (opts.sourceType !== undefined) {
      // New format: separate source and prompt args
      if (opts.sourceType === 'source') args.push('--source', opts.sourceValue);
      else if (opts.sourceType === 'spec')
        args.push('--spec', opts.sourceValue);
      if (opts.prompt) {
        if (Buffer.byteLength(opts.prompt, 'utf8') > ARG_INLINE_LIMIT) {
          promptFilePath = writePromptFile(opts.prompt);
          args.push('--prompt-file', promptFilePath);
        } else {
          args.push('--prompt', opts.prompt);
        }
      }
    } else {
      // Legacy format: inputType/inputValue
      const flag =
        opts.inputType === 'source'
          ? '--source'
          : opts.inputType === 'spec'
            ? '--spec'
            : '--prompt';
      if (
        flag === '--prompt' &&
        opts.inputValue &&
        Buffer.byteLength(opts.inputValue, 'utf8') > ARG_INLINE_LIMIT
      ) {
        promptFilePath = writePromptFile(opts.inputValue);
        args.push('--prompt-file', promptFilePath);
      } else {
        args.push(flag, opts.inputValue);
      }
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
      const child = spawn('python3', args, {
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
        cleanupPromptFile(promptFilePath);
        const err = new Error(`Failed to start pipeline: ${spawnErr.message}`);
        err.code = 'spawn_error';
        reject(err);
      });

      child.on('exit', (code, signal) => {
        cleanup();
        if (code !== null && code !== 0) {
          cleanupPromptFile(promptFilePath);
          const err = new Error(
            `Pipeline exited immediately with code ${code}`,
          );
          err.code = 'spawn_error';
          reject(err);
        } else if (signal) {
          cleanupPromptFile(promptFilePath);
          const err = new Error(`Pipeline killed by signal ${signal}`);
          err.code = 'spawn_error';
          reject(err);
        }
        // code === 0 or code === null (still running) — resolve
        // run_pipeline.py handles prompt file cleanup after reading
        child.unref();
        resolve({ pid: child.pid });
      });
    });
  }

  /**
   * Stop a running pipeline.
   * PID file is the sole source of truth — no pgrep fallback.
   * @returns {{ pid: number, stopped: boolean }}
   */
  stopPipeline() {
    let pid = null;
    const pidPath = join(this.worcaDir, 'pipeline.pid');

    if (existsSync(pidPath)) {
      try {
        pid = parseInt(readFileSync(pidPath, 'utf8').trim(), 10);
        process.kill(pid, 0); // verify alive
      } catch {
        try {
          unlinkSync(pidPath);
        } catch {
          /* ignore */
        }
        pid = null;
      }
    }

    if (!pid) {
      const err = new Error('No running pipeline found');
      err.code = 'not_running';
      throw err;
    }

    // Belt-and-suspenders: write control.json so the orchestrator gets a clean signal
    const activeRunPath = join(this.worcaDir, 'active_run');
    if (existsSync(activeRunPath)) {
      try {
        const runId = readFileSync(activeRunPath, 'utf8').trim();
        if (runId) {
          const controlDir = join(this.worcaDir, 'runs', runId);
          mkdirSync(controlDir, { recursive: true });
          writeFileSync(
            join(controlDir, 'control.json'),
            `${JSON.stringify(
              {
                action: 'stop',
                requested_at: new Date().toISOString(),
                source: 'ui',
              },
              null,
              2,
            )}\n`,
            'utf8',
          );
        }
      } catch {
        /* non-fatal */
      }
    }

    try {
      process.kill(pid, 'SIGTERM');
    } catch (e) {
      try {
        unlinkSync(pidPath);
      } catch {
        /* ignore */
      }
      const err = new Error(`Failed to stop pipeline: ${e.message}`);
      err.code = 'not_running';
      throw err;
    }

    // Watchdog: SIGKILL after 10s if still alive, then reconcile status
    const worcaDir = this.worcaDir;
    const watchdog = setTimeout(() => {
      try {
        process.kill(pid, 0); // check alive
        process.kill(pid, 'SIGKILL');
        // Give the OS a moment to reap the process, then fix stale status
        setTimeout(() => reconcileStatus(worcaDir), 500);
      } catch {
        // Already dead — reconcile in case signal handler didn't save
        reconcileStatus(worcaDir);
      }
    }, 10000);
    watchdog.unref();

    // Clean up PID file
    try {
      unlinkSync(pidPath);
    } catch {
      /* ignore */
    }

    return { pid, stopped: true };
  }

  /**
   * Pause a running pipeline by writing a control file.
   * @param {string} runId - Pipeline run identifier
   * @returns {{ runId: string, paused: boolean }}
   */
  pausePipeline(runId) {
    const controlDir = join(this.worcaDir, 'runs', runId);
    mkdirSync(controlDir, { recursive: true });
    writeFileSync(
      join(controlDir, 'control.json'),
      `${JSON.stringify(
        {
          action: 'pause',
          requested_at: new Date().toISOString(),
          source: 'ui',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    return { runId, paused: true };
  }

  /**
   * Restart a failed stage by resetting it and spawning with --resume.
   * @param {string} stageKey - The stage key to restart
   * @param {{ projectRoot?: string }} opts
   * @returns {Promise<{ pid: number, stage: string }>}
   */
  async restartStage(stageKey, opts = {}) {
    const running = this.getRunningPid();
    if (running) {
      const err = new Error(`Pipeline already running (PID ${running.pid})`);
      err.code = 'already_running';
      throw err;
    }

    const cwd = opts.projectRoot || this.projectRoot;
    const scriptPath = join(cwd, '.claude/scripts/run_pipeline.py');
    if (!existsSync(scriptPath)) {
      const err = new Error(`Pipeline script not found at ${scriptPath}`);
      err.code = 'script_not_found';
      throw err;
    }

    // Find status.json — check active_run first, then legacy
    let statusPath = null;
    const activeRunPath = join(this.worcaDir, 'active_run');
    if (existsSync(activeRunPath)) {
      try {
        const runId = readFileSync(activeRunPath, 'utf8').trim();
        const candidate = join(this.worcaDir, 'runs', runId, 'status.json');
        if (existsSync(candidate)) statusPath = candidate;
      } catch {
        /* ignore */
      }
    }
    if (!statusPath) {
      const legacy = join(this.worcaDir, 'status.json');
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
      const err = new Error(
        `Stage "${stageKey}" is not in error state (current: ${status.stages[stageKey].status})`,
      );
      err.code = 'stage_not_error';
      throw err;
    }

    // Reset the stage
    status.stages[stageKey].status = 'pending';
    delete status.stages[stageKey].error;
    delete status.stages[stageKey].completed_at;
    writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8');

    // Spawn with --resume
    const env = { ...process.env };
    delete env.CLAUDECODE;

    return new Promise((resolve, reject) => {
      const child = spawn(
        'python3',
        ['.claude/scripts/run_pipeline.py', '--resume'],
        {
          detached: true,
          stdio: 'ignore',
          cwd,
          env,
        },
      );

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
          const err = new Error(
            `Pipeline exited immediately with code ${code}`,
          );
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
}

// ─── Backward-compatible free-function exports ──────────────────────────────
// These delegate to a one-off ProcessManager instance so existing callers
// (app.js, ws.js, tests) continue to work without changes during Phase 0.

/** @param {string} worcaDir */
export function getRunningPid(worcaDir) {
  return new ProcessManager({ worcaDir }).getRunningPid();
}

/** @param {string} worcaDir */
export function reconcileStatus(worcaDir) {
  return new ProcessManager({ worcaDir }).reconcileStatus();
}

/** @param {string} worcaDir @param {object} opts */
export async function startPipeline(worcaDir, opts = {}) {
  return new ProcessManager({
    worcaDir,
    projectRoot: opts.projectRoot,
  }).startPipeline(opts);
}

/** @param {string} worcaDir */
export function stopPipeline(worcaDir) {
  return new ProcessManager({ worcaDir }).stopPipeline();
}

/** @param {string} worcaDir @param {string} runId */
export function pausePipeline(worcaDir, runId) {
  return new ProcessManager({ worcaDir }).pausePipeline(runId);
}

/** @param {string} worcaDir @param {string} stageKey @param {object} opts */
export async function restartStage(worcaDir, stageKey, opts = {}) {
  return new ProcessManager({
    worcaDir,
    projectRoot: opts.projectRoot,
  }).restartStage(stageKey, opts);
}
