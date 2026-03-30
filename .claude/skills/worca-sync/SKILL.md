---
name: worca-sync
description: Sync worca files (worca/, worca-ui/, agents/, hooks/, scripts/, skills/) from the worca-cc source repo to a target project's .claude/ directory. Use when updating a project with the latest worca pipeline files, or when the user says "sync worca", "update worca", or "copy worca files". Accepts an optional path argument to specify the worca-cc repo location.
---

# Sync Worca to Project

Sync the worca pipeline files from the worca-cc source repository to a target project's `.claude/` directory.

## Source Repository Resolution (priority order)

1. **Explicit argument** — if the user passes a path (e.g. `/worca-sync /path/to/worca-cc`), use that
2. **Stored path** — read `worca.source_repo` from the target's `.claude/settings.json` (set during `/worca-install`)
3. **Auto-detect** — if CWD is inside worca-cc, use `git rev-parse --show-toplevel`
4. **Ask the user** — if none of the above work

After resolving, validate that `$WORCA_ROOT/.claude/worca/` exists to confirm it's actually a worca-cc repo.

**If a new source path is used (explicit or auto-detected), update `worca.source_repo` in the target's `settings.json`** so future syncs find it automatically.

## What Gets Synced

| Directory | Mode | Contents |
|-----------|------|----------|
| `.claude/worca/` | `--delete` | Python orchestrator, hooks, schemas, state, utils |
| `.claude/worca-ui/` | `--delete` | Node.js dashboard UI (app, server, bin, scripts, tests) |
| `.claude/agents/` | `--delete` (excludes `overrides/`) | Core agent definitions (coordinator, guardian, implementer, planner, tester) |
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
rsync -av --delete --exclude='node_modules' --exclude='__pycache__' --exclude='test-results/' "$SRC/worca-ui/" "$DEST/worca-ui/"
rsync -av --delete --exclude='overrides/' "$SRC/agents/" "$DEST/agents/"
rsync -av --delete --exclude='__pycache__' "$SRC/hooks/" "$DEST/hooks/"
rsync -av --delete --exclude='__pycache__' "$SRC/scripts/" "$DEST/scripts/"

# Skills (additive — do NOT --delete, target may have project-specific skills)
# Exclude worca-install — it's only needed in the worca-cc source repo
rsync -av --exclude='node_modules' --exclude='__pycache__' --exclude='worca-install/' "$SRC/skills/" "$DEST/skills/"
```

### Step 4: Deep-merge settings.json (never overwrite existing values)

The target project's `settings.json` contains project-specific customizations (permissions, models, max_turns, plan paths, pricing, governance thresholds, etc.) that **must never be overwritten**.

Use a **deep merge** strategy: recursively walk the source JSON and only insert keys that do **not** already exist in the target. Existing values at any depth are always preserved.

#### Merge rules

1. Read both `$WORCA_ROOT/.claude/settings.json` (source) and `$DEST/settings.json` (target)
2. **Skip entirely** — never touch these top-level keys even if missing: `permissions`, `enableAllProjectMcpServers`, `enabledMcpjsonServers`, `model`, `deny`
3. **Preserve** the target's `worca.source_repo` value — do not overwrite it with the source's value
4. For `hooks` and `worca` sections, apply the deep-merge function below
5. If nothing was added, report "settings.json already up to date"
6. If new keys were added, report exactly which keys were inserted

#### Deep-merge algorithm

```python
import json, copy

def deep_merge_new_only(source, target):
    """Recursively add keys from source that are missing in target.
    Never overwrite existing target values at any depth."""
    added = []
    for key, value in source.items():
        if key not in target:
            target[key] = copy.deepcopy(value)
            added.append(key)
        elif isinstance(value, dict) and isinstance(target[key], dict):
            sub_added = deep_merge_new_only(value, target[key])
            added.extend(f"{key}.{k}" for k in sub_added)
        # else: key exists in target — leave it untouched
    return added

# Usage
src = json.load(open(f"{WORCA_ROOT}/.claude/settings.json"))
tgt = json.load(open(f"{DEST}/settings.json"))

SKIP_KEYS = {"permissions", "enableAllProjectMcpServers", "enabledMcpjsonServers", "model", "deny"}

added_keys = []
for section in ("hooks", "worca"):
    if section in src:
        tgt.setdefault(section, {})
        added = deep_merge_new_only(src[section], tgt[section])
        added_keys.extend(f"{section}.{k}" for k in added)

# Remove worca.source_repo if it was just added from source (preserve target's value)
if "worca.source_repo" in added_keys:
    # Will be set correctly in Step 5
    pass

if added_keys:
    json.dump(tgt, open(f"{DEST}/settings.json", "w"), indent=2)
    print(f"Added {len(added_keys)} new keys: {added_keys}")
else:
    print("settings.json already up to date")
```

#### Examples of what this preserves

| Target has | Source has | Result |
|-----------|-----------|--------|
| `worca.agents.planner.model: "sonnet"` | `worca.agents.planner.model: "opus"` | Keeps `"sonnet"` (user's choice) |
| `worca.agents.coordinator.max_turns: 500` | `worca.agents.coordinator.max_turns: 300` | Keeps `500` (user's choice) |
| `worca.plan_path_template: "plans/{title}.md"` | `worca.plan_path_template: "docs/plans/..."` | Keeps user's template |
| *(missing)* `worca.pricing` | `worca.pricing: {...}` | Adds pricing section |
| `hooks.PreToolUse: [custom]` | `hooks.PreToolUse: [default]` | Keeps user's custom hooks |

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

### Step 7: Install worca-ui dependencies (if needed) and rebuild

If `$DEST/worca-ui/node_modules/` does not exist, run `npm install` first. Then always rebuild the UI bundle:

```bash
cd "$DEST/worca-ui" && npm install && npm run build
```

### Step 7.5: Ensure project is registered

Register the target project in the worca-ui multi-project selector (covers projects installed before multi-project support was added).

```bash
PREFS_DIR="$HOME/.worca"
PROJ_NAME=$(basename "<target-project>")
mkdir -p "$PREFS_DIR/projects.d"

# Slugify: lowercase, replace non-alphanumeric with hyphens, collapse
SLUG=$(echo "$PROJ_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]/-/g' | sed 's/--*/-/g' | cut -c1-64)

# Only write if not already registered (don't overwrite existing entry)
if [ ! -f "$PREFS_DIR/projects.d/$SLUG.json" ]; then
  cat > "$PREFS_DIR/projects.d/$SLUG.json" << EOF
{
  "name": "$SLUG",
  "path": "$(cd "<target-project>" && pwd)"
}
EOF
fi
```

If the project was registered, note it in the summary. If it already existed, note "already registered".

### Step 8: Report results

Show a summary table of what was synced, the source path used, whether settings needed merging, and project registration status (e.g. `Registered: ~/.worca/projects.d/<slug>.json (new / already existed)`).
