/**
 * Worca install/update logic for the UI server.
 *
 * - getSourceRoot()             → resolve worca-cc repo root from server location
 * - checkWorcaInstalled(path)   → check if .claude/worca/ exists in a project
 * - runWorcaSetup(src, target)  → spawn rsync + npm build + settings merge + beads init
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
    `${JSON.stringify(
      {
        status: 'running',
        started_at: new Date().toISOString(),
        source: sourcePath,
        target: targetPath,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  // Build a shell script that:
  // 1. rsyncs worca dirs
  // 2. deep-merges settings.json (hooks + worca sections, never overwrites existing)
  // 3. installs deps + builds UI
  // 4. ensures .gitignore entries
  // 5. initializes beads if bd CLI is available
  const script = `
set -e
SRC=$(printf '%s' "$1")
DEST=$(printf '%s' "$2")
STATUS=$(printf '%s' "$3")
SOURCE_ROOT=$(printf '%s' "$4")
TARGET_ROOT=$(printf '%s' "$5")

# --- Step 1: rsync worca directories ---
rsync -a --delete --exclude='node_modules' --exclude='__pycache__' "$SRC/worca/" "$DEST/worca/"
rsync -a --delete --exclude='node_modules' --exclude='__pycache__' --exclude='test-results/' "$SRC/worca-ui/" "$DEST/worca-ui/"
rsync -a --delete --exclude='overrides/' "$SRC/agents/" "$DEST/agents/"
rsync -a --delete --exclude='__pycache__' "$SRC/hooks/" "$DEST/hooks/"
rsync -a --delete --exclude='__pycache__' "$SRC/scripts/" "$DEST/scripts/"

# Skills (additive — no --delete, target may have project-specific skills)
rsync -a --exclude='node_modules' --exclude='__pycache__' --exclude='worca-install/' "$SRC/skills/" "$DEST/skills/"

# --- Step 2: deep-merge settings.json ---
python3 - "$SRC/settings.json" "$DEST/settings.json" "$SOURCE_ROOT" << 'PYEOF'
import sys, json, copy, os

src_path, dest_path, source_root = sys.argv[1], sys.argv[2], sys.argv[3]

def deep_merge_new_only(source, target):
    added = []
    for key, value in source.items():
        if key not in target:
            target[key] = copy.deepcopy(value)
            added.append(key)
        elif isinstance(value, dict) and isinstance(target[key], dict):
            sub = deep_merge_new_only(value, target[key])
            added.extend(f"{key}.{k}" for k in sub)
    return added

src = json.load(open(src_path))

# If target settings.json doesn't exist, seed it with minimal structure
if not os.path.exists(dest_path):
    tgt = {}
else:
    tgt = json.load(open(dest_path))

# Only merge hooks and worca sections; skip permissions, MCP, model, deny
added_keys = []
for section in ("hooks", "worca"):
    if section in src:
        tgt.setdefault(section, {})
        added = deep_merge_new_only(src[section], tgt[section])
        added_keys.extend(f"{section}.{k}" for k in added)

# Always set source_repo to the current worca-cc path
tgt.setdefault("worca", {})["source_repo"] = source_root

with open(dest_path, "w") as f:
    json.dump(tgt, f, indent=2)
    f.write("\\n")

if added_keys:
    print(f"settings.json: added {len(added_keys)} new keys")
else:
    print("settings.json: already up to date")
PYEOF

# --- Step 3: install deps and build UI ---
cd "$DEST/worca-ui" && npm install && npm run build

# --- Step 4: ensure .gitignore entries ---
GITIGNORE="$TARGET_ROOT/.gitignore"
for pattern in ".worca/" ".claude/worca-ui/node_modules/" ".claude/settings.local.json"; do
  if [ -f "$GITIGNORE" ]; then
    grep -qxF "$pattern" "$GITIGNORE" 2>/dev/null || echo "$pattern" >> "$GITIGNORE"
  else
    echo "$pattern" >> "$GITIGNORE"
  fi
done

# --- Step 5: initialize beads if bd CLI is available ---
if command -v bd >/dev/null 2>&1; then
  if [ ! -d "$TARGET_ROOT/.beads" ]; then
    cd "$TARGET_ROOT" && bd init 2>&1 || echo "beads init failed (non-fatal)"
  fi
fi
`;

  const child = spawn(
    'bash',
    ['-c', script, '--', src, dest, statusFile, sourcePath, targetPath],
    {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    },
  );

  // On error, write failure status
  child.on('error', () => {
    try {
      writeFileSync(
        statusFile,
        JSON.stringify({ status: 'error', error: 'spawn failed' }, null, 2) +
          '\n',
        'utf8',
      );
    } catch {
      /* best effort */
    }
  });

  child.on('exit', (code) => {
    if (code !== 0) {
      try {
        writeFileSync(
          statusFile,
          `${JSON.stringify(
            {
              status: 'error',
              error: `Process exited with code ${code}`,
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
    } else {
      try {
        writeFileSync(
          statusFile,
          `${JSON.stringify(
            {
              status: 'done',
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
    }
  });

  child.unref();

  return { pid: child.pid };
}
