---
name: sync-worca
description: Sync worca files (worca/, worca-ui/, agents/, hooks/, scripts/, skills/) from the worca-cc source repo to a target project's .claude/ directory. Use when updating a project with the latest worca pipeline files, or when the user says "sync worca", "update worca", or "copy worca files". Accepts an optional path argument to specify the worca-cc repo location.
---

# Sync Worca to Project

Sync the worca pipeline files from the worca-cc source repository to a target project's `.claude/` directory.

## Source Repository Resolution (priority order)

1. **Explicit argument** — if the user passes a path (e.g. `/sync-worca /path/to/worca-cc`), use that
2. **Stored path** — read `worca.source_repo` from the target's `.claude/settings.json` (set during `/install-worca`)
3. **Auto-detect** — if CWD is inside worca-cc, use `git rev-parse --show-toplevel`
4. **Ask the user** — if none of the above work

After resolving, validate that `$WORCA_ROOT/.claude/worca/` exists to confirm it's actually a worca-cc repo.

**If a new source path is used (explicit or auto-detected), update `worca.source_repo` in the target's `settings.json`** so future syncs find it automatically.

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

### Step 1: Resolve source path

```bash
# Priority 1: explicit argument
WORCA_ROOT=<user-provided-path>

# Priority 2: read from target settings.json
WORCA_ROOT=$(python3 -c "import json; print(json.load(open('.claude/settings.json')).get('worca',{}).get('source_repo',''))" 2>/dev/null)

# Priority 3: auto-detect if CWD is inside worca-cc
WORCA_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)

# Validate
test -d "$WORCA_ROOT/.claude/worca" || echo "ERROR: not a worca-cc repo"
```

### Step 2: Determine target project directory

If not specified, use the current working directory. Confirm the target has a `.claude/` directory. Create it if missing.

### Step 3: Rsync each directory

```bash
SRC="$WORCA_ROOT/.claude"
DEST=<target-project>/.claude

# Core worca directories (--delete removes stale files)
rsync -av --delete --exclude='node_modules' --exclude='__pycache__' "$SRC/worca/" "$DEST/worca/"
rsync -av --delete --exclude='node_modules' --exclude='__pycache__' "$SRC/worca-ui/" "$DEST/worca-ui/"
rsync -av --delete "$SRC/agents/" "$DEST/agents/"
rsync -av --delete --exclude='__pycache__' "$SRC/hooks/" "$DEST/hooks/"
rsync -av --delete --exclude='__pycache__' "$SRC/scripts/" "$DEST/scripts/"

# Skills (additive — do NOT --delete, target may have project-specific skills)
# Exclude install-worca — it's only needed in the worca-cc source repo
rsync -av --exclude='node_modules' --exclude='__pycache__' --exclude='install-worca/' "$SRC/skills/" "$DEST/skills/"
```

### Step 4: Merge settings.json (do NOT overwrite)

The target project's `settings.json` contains project-specific permissions, MCP server config, and model preferences that must be preserved.

1. Read both `$WORCA_ROOT/.claude/settings.json` (source) and `$DEST/settings.json` (target)
2. Compare the `hooks` and `worca` sections — update target if source has changes
3. **Never overwrite** the `permissions`, `enableAllProjectMcpServers`, `enabledMcpjsonServers`, `model`, or `deny` fields — these are project-specific
4. **Preserve** the target's `worca.source_repo` value — do not overwrite it with the source's value
5. If hooks and worca config are identical, report "settings.json already up to date"
6. If there are differences, merge only the `hooks` and `worca` keys into the target

### Step 5: Update stored source path

If the resolved source path differs from what's in `worca.source_repo`, update it:

```python
import json
settings_path = "<target>/.claude/settings.json"
settings = json.load(open(settings_path))
settings.setdefault("worca", {})["source_repo"] = WORCA_ROOT
json.dump(settings, open(settings_path, "w"), indent=2)
```

### Step 6: Skip these files

- `settings.local.json` — machine-specific, never copy or merge
- `.worca/` — runtime state directory, project-specific
- `worktrees/` — git worktree state, project-specific

### Step 7: Install worca-ui dependencies (if needed)

If `$DEST/worca-ui/node_modules/` does not exist, run:

```bash
cd "$DEST/worca-ui" && npm install
```

### Step 8: Report results

Show a summary table of what was synced, the source path used, and whether settings needed merging.
