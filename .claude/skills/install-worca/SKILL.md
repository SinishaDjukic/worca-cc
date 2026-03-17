---
name: install-worca
description: Install worca pipeline into a new project. Requires a target path argument (e.g. /install-worca /path/to/project). Copies .claude/ files, stores the source repo path for future syncs, installs dependencies, and initializes beads. Use when the user says "install worca", "setup worca", or "add worca to project".
---

# Install Worca into a New Project

First-time installation of the worca pipeline into a target project. This copies all pipeline files, stores the source repo path for future `/sync-worca` updates, installs dependencies, and initializes beads.

**Usage:** `/install-worca <target-project-path>` — the target path is **mandatory**.

## Source Repository

The source is the **worca-cc repo that contains this skill file**. Auto-detect it:

1. **If CWD is inside worca-cc**: `git rev-parse --show-toplevel`
2. **Otherwise**: ask the user for the worca-cc repo path

Store the resolved **absolute path** — it will be saved in the target's `settings.json` for future syncs.

## Procedure

### Step 1: Validate arguments and resolve paths

The user **must** provide the target project path as an argument. If missing, ask for it — do not proceed without it.

```bash
# Resolve the worca-cc source repo root (absolute path)
WORCA_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
# If CWD is not inside worca-cc, ask the user for the path

# Target from mandatory argument
DEST=<target-project-path>
```

Validate:
- `$WORCA_ROOT/.claude/worca/` exists (confirms it's actually worca-cc)
- `$DEST` exists and is a git repository
- `$DEST/.claude/worca/` does NOT exist (this is install, not sync — if it exists, suggest `/sync-worca` instead)

### Step 2: Copy .claude/ directory

```bash
SRC="$WORCA_ROOT/.claude"

# Create .claude if missing
mkdir -p "$DEST/.claude"

# Core worca directories
rsync -av --exclude='node_modules' --exclude='__pycache__' "$SRC/worca/" "$DEST/.claude/worca/"
rsync -av --exclude='node_modules' --exclude='__pycache__' "$SRC/worca-ui/" "$DEST/.claude/worca-ui/"
rsync -av "$SRC/agents/" "$DEST/.claude/agents/"
rsync -av --exclude='__pycache__' "$SRC/hooks/" "$DEST/.claude/hooks/"
rsync -av --exclude='__pycache__' "$SRC/scripts/" "$DEST/.claude/scripts/"

# Skills — exclude install-worca (only needed in the worca-cc source repo, not target projects)
rsync -av --exclude='node_modules' --exclude='__pycache__' --exclude='install-worca/' "$SRC/skills/" "$DEST/.claude/skills/"
```

### Step 3: Copy and patch settings.json

Copy `settings.json` from source, then add the `worca.source_repo` key:

```bash
cp "$SRC/settings.json" "$DEST/.claude/settings.json"
```

Then use a JSON tool (python/jq) to set:

```json
{
  "worca": {
    "source_repo": "/absolute/path/to/worca-cc"
  }
}
```

This stores the source path so that `/sync-worca` can find it automatically in the future.

**Do NOT copy** `settings.local.json` — it is machine-specific.

### Step 4: Install worca-ui dependencies

```bash
cd "$DEST/.claude/worca-ui" && npm install
```

### Step 5: Initialize beads (if bd CLI is available)

```bash
cd "$DEST" && bd init
```

If `bd` is not installed, warn the user:
```
beads CLI not found. Install it with: npm install -g @beads/bd@0.49.0
Then run: cd <target-project> && bd init
```

### Step 6: Create .worca runtime directory

```bash
mkdir -p "$DEST/.worca"
```

Check that `.worca` is in the target project's `.gitignore`. If not, add it:

```bash
echo ".worca/" >> "$DEST/.gitignore"
```

Also ensure these are gitignored:

```
.claude/worca-ui/node_modules/
.claude/settings.local.json
```

### Step 7: Report results

Show a summary:

```
Worca installed successfully!

  Source:    /absolute/path/to/worca-cc
  Target:    /absolute/path/to/target-project
  Stored:    worca.source_repo in .claude/settings.json

  Copied:
    .claude/worca/         done
    .claude/worca-ui/      done  (npm install done)
    .claude/agents/        done
    .claude/hooks/         done
    .claude/scripts/       done
    .claude/skills/        done  (install-worca excluded)
    .claude/settings.json  done  (source_repo saved)

  Beads:     initialized / skipped (bd not found)
  Gitignore: updated

  Next steps:
    cd <target-project> && claude          # Interactive mode
    python .claude/scripts/run_pipeline.py --prompt "..."  # Autonomous mode
    /sync-worca                            # Update worca files later
```
