/**
 * Worca install/update logic for the UI server.
 *
 * Delegates to the `worca init` CLI for installation and upgrades.
 * The UI only needs to check installation status and spawn the CLI.
 *
 * - checkWorcaInstalled(path)   → check if .claude/worca/ exists in a project
 * - runWorcaSetup(targetPath, opts) → spawn `worca init --upgrade` in the project
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Check whether worca is installed in the given project path.
 */
export function checkWorcaInstalled(projectPath, worcaConfigPath) {
  if (worcaConfigPath && existsSync(worcaConfigPath)) return true;
  return existsSync(join(projectPath, '.claude', 'worca'));
}

/**
 * Read the worca-cc version from a project's worca installation.
 * Tries .claude/worca/version.json first, then falls back to __init__.py.
 * Returns the version string or null if not found.
 */
export function readProjectWorcaVersion(projectPath, worcaPkgVersion) {
  if (worcaPkgVersion) return worcaPkgVersion.replace(/-[0-9a-f]{7,}$/, '');
  try {
    const versionJson = JSON.parse(
      readFileSync(
        join(projectPath, '.claude', 'worca', 'version.json'),
        'utf8',
      ),
    );
    if (versionJson.version) return versionJson.version;
  } catch {
    // fall through to __init__.py
  }
  try {
    const initPy = readFileSync(
      join(projectPath, '.claude', 'worca', '__init__.py'),
      'utf8',
    );
    const match = initPy.match(/^__version__\s*=\s*["']([^"']+)["']/m);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Spawn `worca init --upgrade` in the target project directory.
 * Optionally passes --source if a source repo path is provided.
 *
 * Returns { pid } immediately. Writes progress to a status file
 * at <targetPath>/.worca/setup-status.json.
 *
 * @param {string} targetPath - The project root directory
 * @param {{ source?: string }} opts - Optional source repo path
 * @returns {{ pid: number }}
 */
export function runWorcaSetup(targetPath, opts = {}) {
  // Ensure .worca dir exists for status file
  const worcaDir = join(targetPath, '.worca');
  mkdirSync(worcaDir, { recursive: true });

  const statusFile = join(worcaDir, 'setup-status.json');

  // Write initial status
  writeFileSync(
    statusFile,
    `${JSON.stringify(
      {
        status: 'running',
        started_at: new Date().toISOString(),
        target: targetPath,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const args = ['init', '--upgrade'];
  if (opts.source) {
    args.push('--source', opts.source);
  }

  const child = spawn('worca', args, {
    detached: true,
    stdio: 'ignore',
    cwd: targetPath,
    env: { ...process.env },
  });

  // On error, write failure status
  child.on('error', (err) => {
    try {
      writeFileSync(
        statusFile,
        `${JSON.stringify(
          {
            status: 'error',
            error: err.message || 'spawn failed',
            finished_at: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
    } catch {
      /* best effort */
    }
  });

  child.on('exit', (code) => {
    const payload =
      code !== 0
        ? {
            status: 'error',
            error: `Process exited with code ${code}`,
            finished_at: new Date().toISOString(),
          }
        : {
            status: 'done',
            finished_at: new Date().toISOString(),
          };
    try {
      writeFileSync(
        statusFile,
        `${JSON.stringify(payload, null, 2)}\n`,
        'utf8',
      );
    } catch {
      /* best effort */
    }
  });

  child.unref();

  return { pid: child.pid };
}
