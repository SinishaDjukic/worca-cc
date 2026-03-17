---
name: sync-worca
description: Sync worca files (worca/, worca-ui/, agents/, hooks/, scripts/, skills/) from the worca-cc source repo to a target project's .claude/ directory. Use when updating a project with the latest worca pipeline files, or when the user says "sync worca", "update worca", or "copy worca files".
---

# Sync Worca to Project

Sync the worca pipeline files from the worca-cc source repository to a target project's `.claude/` directory.

## Source Repository

The canonical source is `~/develop/github/SinishaDjukic/worca-cc/`. All worca files live under `.claude/` in that repo.

## What Gets Synced

| Directory | Mode | Contents |
|-----------|------|----------|
| `.claude/worca/` | `--delete` | Python orchestrator, hooks, schemas, state, utils |
| `.claude/worca-ui/` | `--delete` | Node.js dashboard UI (app, server, bin, scripts, tests) |
| `.claude/agents/` | `--delete` | Core agent definitions (coordinator, guardian, implementer, planner, tester) |
| `.claude/hooks/` | `--delete` | Claude Code hook scripts (pre/post tool use, session, prompt, etc.) |
| `.claude/scripts/` | `--delete` | Runner scripts (batch, parallel, pipeline) |
| `.claude/skills/` | **additive** | Worca-provided skills (no `--delete` — preserves project-specific skills) |

## Procedure

### Step 1: Determine target project directory

If not specified, use the current working directory. Confirm the target has a `.claude/` directory. Create it if missing.

### Step 2: Rsync each directory

Run these rsync commands. Directories with `--delete` remove stale files. Skills uses additive sync to preserve project-specific skills.

```bash
SRC=~/develop/github/SinishaDjukic/worca-cc/.claude
DEST=<target-project>/.claude

# Core worca directories (--delete removes stale files)
rsync -av --delete --exclude='node_modules' --exclude='__pycache__' "$SRC/worca/" "$DEST/worca/"
rsync -av --delete --exclude='node_modules' --exclude='__pycache__' "$SRC/worca-ui/" "$DEST/worca-ui/"
rsync -av --delete "$SRC/agents/" "$DEST/agents/"
rsync -av --delete --exclude='__pycache__' "$SRC/hooks/" "$DEST/hooks/"
rsync -av --delete --exclude='__pycache__' "$SRC/scripts/" "$DEST/scripts/"

# Skills (additive — do NOT --delete, target may have project-specific skills)
rsync -av --exclude='node_modules' --exclude='__pycache__' "$SRC/skills/" "$DEST/skills/"
```

### Step 3: Merge settings.json (do NOT overwrite)

The target project's `settings.json` contains project-specific permissions, MCP server config, and model preferences that must be preserved.

1. Read both `$SRC/../settings.json` (source) and `$DEST/../settings.json` (target)
2. Compare the `hooks` and `worca` sections — update target if source has changes
3. **Never overwrite** the `permissions`, `enableAllProjectMcpServers`, `enabledMcpjsonServers`, `model`, or `deny` fields — these are project-specific
4. If hooks and worca config are identical, report "settings.json already up to date"
5. If there are differences, merge only the `hooks` and `worca` keys into the target

### Step 4: Skip these files

- `settings.local.json` — machine-specific, never copy or merge
- `.worca/` — runtime state directory, project-specific
- `worktrees/` — git worktree state, project-specific

### Step 5: Install worca-ui dependencies (if needed)

If `$DEST/worca-ui/node_modules/` does not exist, run:

```bash
cd "$DEST/worca-ui" && npm install
```

### Step 6: Ensure required permissions

The target project's `settings.json` must have these permissions for the sync to run without prompts:

```json
"Bash(python3:*)",
"Bash(rsync:*)"
```

Check the `permissions.allow` array in the target's `settings.json`. Add any missing entries.

### Step 7: Report results

Show a summary table of what was synced and whether settings needed merging.
