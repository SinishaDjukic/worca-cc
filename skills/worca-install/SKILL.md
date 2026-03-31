---
name: worca-install
description: Install the worca autonomous pipeline into a project. Triggers on "install worca", "setup worca", "add worca", "create a pipeline", "set up autonomous development", "use worca-cc", "worca for my project", "let's create a pipeline", "run pipeline on my project", or any request to use worca to automate development on a target project. Requires a target project path (e.g. /worca-install /path/to/project).
---

# Install Worca into a New Project

First-time installation of the worca pipeline into a target project. This copies all pipeline files, stores the source repo path for future `/worca-sync` updates, installs dependencies, and initializes beads.

**Usage:** `/worca-install <target-project-path>` — the target path is **mandatory**.

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
- `$DEST/.claude/worca/` does NOT exist (this is install, not sync — if it exists, suggest `/worca-sync` instead)

### Step 2: Copy .claude/ directory

```bash
SRC="$WORCA_ROOT/.claude"

# Create .claude if missing
mkdir -p "$DEST/.claude"

# Core worca directories
rsync -av --exclude='node_modules' --exclude='__pycache__' "$SRC/worca/" "$DEST/.claude/worca/"
rsync -av --exclude='node_modules' --exclude='__pycache__' --exclude='test-results/' "$SRC/worca-ui/" "$DEST/.claude/worca-ui/"
rsync -av --exclude='overrides/' "$SRC/agents/" "$DEST/.claude/agents/"
rsync -av --exclude='__pycache__' "$SRC/hooks/" "$DEST/.claude/hooks/"
rsync -av --exclude='__pycache__' "$SRC/scripts/" "$DEST/.claude/scripts/"

# Skills — exclude worca-install (only needed in the worca-cc source repo, not target projects)
rsync -av --exclude='node_modules' --exclude='__pycache__' --exclude='worca-install/' "$SRC/skills/" "$DEST/.claude/skills/"
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

This stores the source path so that `/worca-sync` can find it automatically in the future.

**Do NOT copy** `settings.local.json` — it is machine-specific.

### Step 4: Install dependencies and build worca-ui

**MANDATORY — do NOT skip this step.** The UI will not work without it.

```bash
cd "$DEST/.claude/worca-ui" && npm install && npm run build
```

Verify the build succeeded by checking that `$DEST/.claude/worca-ui/app/main.bundle.js` exists.

### Step 5: Install Python dev dependencies

```bash
cd "$DEST" && pip install -e ".[dev]"
```

If `pyproject.toml` does not exist in the target project root, skip this step.

### Step 6: Initialize beads (if bd CLI is available)

```bash
cd "$DEST" && bd init
```

If `bd` is not installed, warn the user:
```
beads CLI not found. Install it with: npm install -g @beads/bd@0.49.0
Then run: cd <target-project> && bd init
```

### Step 7: Create .worca runtime directory

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

### Step 7.5: Register project in worca-ui

Register the target project so it appears in the worca-ui multi-project selector.

```bash
PREFS_DIR="$HOME/.worca"
PROJ_NAME=$(basename "$DEST")
mkdir -p "$PREFS_DIR/projects.d"

# Slugify: lowercase, replace non-alphanumeric with hyphens, collapse
SLUG=$(echo "$PROJ_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]/-/g' | sed 's/--*/-/g' | cut -c1-64)

# Only write if not already registered (don't overwrite existing entry)
if [ ! -f "$PREFS_DIR/projects.d/$SLUG.json" ]; then
  cat > "$PREFS_DIR/projects.d/$SLUG.json" << EOF
{
  "name": "$SLUG",
  "path": "$(cd "$DEST" && pwd)"
}
EOF
fi
```

If the project was registered, note it in the summary. If it already existed, note "already registered".

### Step 8: Report results

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
    .claude/skills/        done  (worca-install excluded)
    .claude/settings.json  done  (source_repo saved)

  Beads:     initialized / skipped (bd not found)
  Gitignore: updated
  Registered: ~/.worca/projects.d/<slug>.json (new / already existed)

  Next steps:
    cd <target-project> && claude          # Interactive mode
    python .claude/scripts/run_pipeline.py --prompt "..."  # Autonomous mode
    /worca-sync                            # Update worca files later
    pnpm worca:ui                          # UI — project appears in selector
```
