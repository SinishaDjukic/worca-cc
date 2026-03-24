/**
 * Multi-project pipeline management.
 * Tracks and manages parallel pipeline runs across multiple project directories.
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync, symlinkSync, copyFileSync } from 'node:fs';
import { join, basename, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { discoverRuns } from './watcher.js';

// Resolve worca-cc .claude root (parent of worca-ui/server/)
const __dirname = dirname(fileURLToPath(import.meta.url));
const WORCA_CC_CLAUDE_ROOT = resolve(__dirname, '..', '..');

/**
 * @typedef {Object} MultiProjectRun
 * @property {string} id - Run ID (timestamp-based)
 * @property {string} prompt - The shared prompt
 * @property {string} [guideFile] - Path to guide file
 * @property {string} [guideContent] - Guide file content
 * @property {Array<{name: string, path: string}>} projects - Project list
 * @property {Object<string, ProjectPipelineStatus>} projectStatuses - Per-project status
 * @property {string} startedAt - ISO timestamp
 * @property {string} [completedAt] - ISO timestamp
 * @property {number} msize
 * @property {number} mloops
 */

/**
 * @typedef {Object} ProjectPipelineStatus
 * @property {string} name - Project name
 * @property {string} path - Project directory path
 * @property {'pending'|'running'|'completed'|'error'} status
 * @property {number} [pid] - Pipeline process PID
 * @property {string} [error] - Error message
 * @property {Object} [pipelineStatus] - The project's .worca status
 */

/**
 * Ensure a project directory has .claude/ with worca pipeline files.
 * Creates symlinks from the project into worca-cc's .claude directory.
 */
function ensureClaudeDir(projectPath) {
  const targetClaude = join(projectPath, '.claude');
  const pipelineMarker = join(targetClaude, 'worca');

  if (existsSync(pipelineMarker)) return; // Already has worca pipeline

  if (existsSync(targetClaude)) {
    // .claude exists but without worca — symlink worca-specific dirs
    for (const subdir of ['worca', 'agents', 'scripts', 'hooks', 'skills']) {
      const src = join(WORCA_CC_CLAUDE_ROOT, subdir);
      const dst = join(targetClaude, subdir);
      if (existsSync(src) && !existsSync(dst)) {
        symlinkSync(src, dst);
      }
    }
    // Copy settings.json if missing
    const srcSettings = join(WORCA_CC_CLAUDE_ROOT, 'settings.json');
    const dstSettings = join(targetClaude, 'settings.json');
    if (existsSync(srcSettings) && !existsSync(dstSettings)) {
      copyFileSync(srcSettings, dstSettings);
    }
    return;
  }

  // No .claude at all — symlink the entire directory
  symlinkSync(WORCA_CC_CLAUDE_ROOT, targetClaude);
}

// In-memory store of active multi-project runs
const activeRuns = new Map();

function generateRunId() {
  const now = new Date();
  return now.toISOString().replace(/[-:T]/g, '').replace(/\..+/, '').slice(0, 15);
}

/**
 * Start a multi-project pipeline run.
 * @param {Object} opts
 * @param {string[]} opts.projects - Array of project directory paths
 * @param {string} opts.prompt - Shared prompt
 * @param {string} [opts.guideFile] - Path to guide markdown file
 * @param {number} [opts.msize=1]
 * @param {number} [opts.mloops=1]
 * @param {number} [opts.maxParallel=5]
 * @param {string} [opts.settingsPath]
 * @param {string} [opts.planFile]
 * @param {string} [opts.branch]
 * @param {string} [opts.worcaCcRoot] - Path to worca-cc .claude directory
 * @param {Function} [opts.onUpdate] - Callback for status updates
 * @returns {MultiProjectRun}
 */
export function startMultiProjectRun(opts) {
  const {
    projects,
    prompt,
    guideFile,
    msize = 1,
    mloops = 1,
    maxParallel = 5,
    settingsPath,
    planFile,
    branch,
    worcaCcRoot,
    onUpdate,
  } = opts;

  // Validate projects
  const validProjects = [];
  for (const p of projects) {
    const absPath = resolve(p);
    if (!existsSync(absPath)) {
      throw new Error(`Project directory not found: ${p}`);
    }
    validProjects.push({ name: basename(absPath), path: absPath });
  }

  if (validProjects.length === 0) {
    throw new Error('No valid project directories provided');
  }

  // Read guide file
  let guideContent = null;
  if (guideFile) {
    const guidePath = resolve(guideFile);
    if (!existsSync(guidePath)) {
      throw new Error(`Guide file not found: ${guideFile}`);
    }
    guideContent = readFileSync(guidePath, 'utf8');
  }

  const runId = generateRunId();
  const run = {
    id: runId,
    prompt,
    guideFile: guideFile || null,
    guideContent,
    projects: validProjects,
    projectStatuses: {},
    startedAt: new Date().toISOString(),
    completedAt: null,
    msize,
    mloops,
    maxParallel,
    succeeded: 0,
    failed: 0,
  };

  // Initialize per-project status
  for (const proj of validProjects) {
    run.projectStatuses[proj.name] = {
      name: proj.name,
      path: proj.path,
      status: 'pending',
      pid: null,
      error: null,
      pipelineStatus: null,
    };
  }

  activeRuns.set(runId, run);

  // Launch pipelines with concurrency control
  _launchPipelines(run, {
    settingsPath,
    planFile,
    branch,
    worcaCcRoot,
    onUpdate,
  });

  return run;
}

/**
 * Launch pipelines for all projects with concurrency control.
 */
async function _launchPipelines(run, opts) {
  const { settingsPath, planFile, branch, worcaCcRoot, onUpdate } = opts;
  const queue = [...run.projects];
  const running = new Set();

  function notify() {
    if (onUpdate) {
      onUpdate(run);
    }
  }

  function launchNext() {
    while (running.size < run.maxParallel && queue.length > 0) {
      const proj = queue.shift();
      running.add(proj.name);
      _launchSinglePipeline(run, proj, {
        settingsPath,
        planFile,
        branch,
        worcaCcRoot,
      }).then(() => {
        running.delete(proj.name);
        notify();
        launchNext();
      }).catch(() => {
        running.delete(proj.name);
        notify();
        launchNext();
      });
    }

    // Check if all done
    if (running.size === 0 && queue.length === 0) {
      run.completedAt = new Date().toISOString();
      run.succeeded = Object.values(run.projectStatuses).filter(s => s.status === 'completed').length;
      run.failed = Object.values(run.projectStatuses).filter(s => s.status === 'error').length;
      notify();
    }
  }

  launchNext();
}

/**
 * Launch a pipeline for a single project.
 */
function _launchSinglePipeline(run, proj, opts) {
  return new Promise((resolve, reject) => {
    const { settingsPath, planFile, branch, worcaCcRoot } = opts;
    const projStatus = run.projectStatuses[proj.name];
    projStatus.status = 'running';

    // Ensure .claude/ is available in the project
    try {
      ensureClaudeDir(proj.path);
    } catch (err) {
      projStatus.status = 'error';
      projStatus.error = `Failed to set up .claude/ in project: ${err.message}`;
      resolve();
      return;
    }

    // Build command
    const args = ['.claude/scripts/run_pipeline.py', '--prompt', run.prompt];

    if (run.guideContent) {
      // Write guide content to a temp file in the project's .worca dir
      const worcaDir = join(proj.path, '.worca');
      mkdirSync(worcaDir, { recursive: true });
      const guideTmpPath = join(worcaDir, '_guide.md');
      writeFileSync(guideTmpPath, run.guideContent, 'utf8');
      args.push('--guide', guideTmpPath);
    }

    if (run.msize > 1) args.push('--msize', String(run.msize));
    if (run.mloops > 1) args.push('--mloops', String(run.mloops));
    if (settingsPath) args.push('--settings', settingsPath);
    if (planFile) args.push('--plan', planFile);
    if (branch) args.push('--branch', `${branch}/${proj.name}`);

    const env = { ...process.env };
    delete env.CLAUDECODE;

    const child = spawn('python3', args, {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: proj.path,
      env,
    });

    projStatus.pid = child.pid;

    let stderr = '';
    child.stderr.on('data', (data) => {
      stderr += data.toString();
      // Keep only last 2000 chars
      if (stderr.length > 2000) stderr = stderr.slice(-2000);
    });

    child.on('error', (err) => {
      projStatus.status = 'error';
      projStatus.error = err.message;
      reject(err);
    });

    child.on('exit', (code) => {
      if (code === 0) {
        projStatus.status = 'completed';
      } else {
        projStatus.status = 'error';
        projStatus.error = stderr.trim().split('\n').pop() || `Exit code ${code}`;
      }
      projStatus.pid = null;

      // Read the project's pipeline status
      const worcaDir = join(proj.path, '.worca');
      try {
        const runs = discoverRuns(worcaDir);
        if (runs.length > 0) {
          projStatus.pipelineStatus = runs[0];
        }
      } catch { /* ignore */ }

      resolve();
    });

    child.unref();
  });
}

/**
 * Get a multi-project run by ID.
 * @param {string} runId
 * @returns {MultiProjectRun|null}
 */
export function getMultiProjectRun(runId) {
  return activeRuns.get(runId) || null;
}

/**
 * List all multi-project runs.
 * @returns {MultiProjectRun[]}
 */
export function listMultiProjectRuns() {
  return Array.from(activeRuns.values()).sort(
    (a, b) => b.startedAt.localeCompare(a.startedAt)
  );
}

/**
 * Get live status for all projects in a multi-project run.
 * Reads each project's .worca directory for current pipeline status.
 * @param {string} runId
 * @returns {MultiProjectRun|null}
 */
export function refreshMultiProjectRun(runId) {
  const run = activeRuns.get(runId);
  if (!run) return null;

  for (const proj of run.projects) {
    const projStatus = run.projectStatuses[proj.name];
    const worcaDir = join(proj.path, '.worca');

    // Check if PID is still alive
    if (projStatus.pid) {
      try {
        process.kill(projStatus.pid, 0);
      } catch {
        // Process died — update status
        if (projStatus.status === 'running') {
          projStatus.status = 'error';
          projStatus.error = 'Pipeline process died unexpectedly';
        }
        projStatus.pid = null;
      }
    }

    // Read current pipeline status from .worca
    try {
      const runs = discoverRuns(worcaDir);
      if (runs.length > 0) {
        projStatus.pipelineStatus = runs[0];
      }
    } catch { /* ignore */ }
  }

  return run;
}

/**
 * Stop a specific project's pipeline in a multi-project run.
 * @param {string} runId
 * @param {string} projectName
 * @returns {boolean}
 */
export function stopProjectPipeline(runId, projectName) {
  const run = activeRuns.get(runId);
  if (!run) return false;

  const projStatus = run.projectStatuses[projectName];
  if (!projStatus || !projStatus.pid) return false;

  try {
    process.kill(projStatus.pid, 'SIGTERM');
    projStatus.status = 'error';
    projStatus.error = 'Stopped by user';
    projStatus.pid = null;
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop all pipelines in a multi-project run.
 * @param {string} runId
 * @returns {number} Number of pipelines stopped
 */
export function stopMultiProjectRun(runId) {
  const run = activeRuns.get(runId);
  if (!run) return 0;

  let stopped = 0;
  for (const projStatus of Object.values(run.projectStatuses)) {
    if (projStatus.pid) {
      try {
        process.kill(projStatus.pid, 'SIGTERM');
        projStatus.status = 'error';
        projStatus.error = 'Stopped by user';
        projStatus.pid = null;
        stopped++;
      } catch { /* ignore */ }
    }
  }

  run.completedAt = new Date().toISOString();
  run.succeeded = Object.values(run.projectStatuses).filter(s => s.status === 'completed').length;
  run.failed = Object.values(run.projectStatuses).filter(s => s.status === 'error').length;

  return stopped;
}
