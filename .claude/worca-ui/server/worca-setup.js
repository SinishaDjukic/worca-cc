/**
 * Worca install/update logic for the UI server.
 *
 * - getSourceRoot()             → resolve worca-cc repo root from server location
 * - checkWorcaInstalled(path)   → check if .claude/worca/ exists in a project
 * - runWorcaSetup(src, target)  → spawn rsync + npm build in background
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve the worca-cc repo root by walking up from the server/ directory
 * until we find a directory containing `.claude/worca/`.
 */
export function getSourceRoot() {
  const serverDir = dirname(fileURLToPath(import.meta.url));
  // serverDir is <repo>/.claude/worca-ui/server
  // Walk up to find repo root (the dir that contains .claude/worca/)
  let dir = serverDir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, '.claude', 'worca'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Check whether worca is installed in the given project path.
 */
export function checkWorcaInstalled(projectPath) {
  return existsSync(join(projectPath, '.claude', 'worca'));
}

/**
 * Spawn a shell script that rsyncs worca dirs from source to target,
 * then runs npm install && npm run build.
 *
 * Returns { pid } immediately. Writes progress to a status file
 * at <targetPath>/.worca/setup-status.json.
 */
export function runWorcaSetup(sourcePath, targetPath) {
  const src = join(sourcePath, '.claude');
  const dest = join(targetPath, '.claude');

  // Ensure .worca dir exists for status file
  const worcaDir = join(targetPath, '.worca');
  mkdirSync(worcaDir, { recursive: true });

  const statusFile = join(worcaDir, 'setup-status.json');

  // Write initial status
  writeFileSync(
    statusFile,
    JSON.stringify({
      status: 'running',
      started_at: new Date().toISOString(),
      source: sourcePath,
      target: targetPath,
    }, null, 2) + '\n',
    'utf8',
  );

  // Build a shell script using printf %q to safely quote paths
  const script = `
set -e
SRC=$(printf '%s' "$1")
DEST=$(printf '%s' "$2")
STATUS=$(printf '%s' "$3")

# Core worca directories (--delete removes stale files)
rsync -a --delete --exclude='node_modules' --exclude='__pycache__' "$SRC/worca/" "$DEST/worca/"
rsync -a --delete --exclude='node_modules' --exclude='__pycache__' --exclude='test-results/' "$SRC/worca-ui/" "$DEST/worca-ui/"
rsync -a --delete --exclude='overrides/' "$SRC/agents/" "$DEST/agents/"
rsync -a --delete --exclude='__pycache__' "$SRC/hooks/" "$DEST/hooks/"
rsync -a --delete --exclude='__pycache__' "$SRC/scripts/" "$DEST/scripts/"

# Skills (additive — no --delete, target may have project-specific skills)
rsync -a --exclude='node_modules' --exclude='__pycache__' --exclude='worca-install/' "$SRC/skills/" "$DEST/skills/"

# Install deps and build UI
cd "$DEST/worca-ui" && npm install && npm run build
`;

  const child = spawn('bash', ['-c', script, '--', src, dest, statusFile], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });

  // On error, write failure status
  child.on('error', () => {
    try {
      writeFileSync(
        statusFile,
        JSON.stringify({ status: 'error', error: 'spawn failed' }, null, 2) + '\n',
        'utf8',
      );
    } catch { /* best effort */ }
  });

  child.on('exit', (code) => {
    if (code !== 0) {
      try {
        writeFileSync(
          statusFile,
          JSON.stringify({
            status: 'error',
            error: `Process exited with code ${code}`,
            finished_at: new Date().toISOString(),
          }, null, 2) + '\n',
          'utf8',
        );
      } catch { /* best effort */ }
    } else {
      try {
        writeFileSync(
          statusFile,
          JSON.stringify({
            status: 'done',
            finished_at: new Date().toISOString(),
          }, null, 2) + '\n',
          'utf8',
        );
      } catch { /* best effort */ }
    }
  });

  child.unref();

  return { pid: child.pid };
}
