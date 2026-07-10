---
description: "Clean up finished worca pipeline worktrees. Use this skill whenever the user wants to clean up old runs, remove worktrees, free disk space, or says anything like 'worca cleanup', 'clean up worktrees', 'remove old runs', 'clean finished runs', 'delete completed worktrees', 'clean up the last 5', 'remove runs older than 7 days'. Also trigger on natural time-based filters like 'clean up runs from last week', 'remove everything older than 3 days', 'clean the last 10 runs'."
---

# Clean up worca worktrees

You are cleaning up finished worca pipeline worktrees to free disk space. Every worktree-mode run creates a git worktree that persists until explicitly removed.

## Flow

### Step 1: Dry run first

Always start with a dry run to show what would be cleaned:

```bash
worca cleanup --dry-run
```

This lists all eligible worktrees (completed or failed runs) without removing anything.

### Step 2: Parse user intent for filters

The user may specify filters in natural language. Map them to CLI flags:

| User says | Flag |
|-----------|------|
| "older than 7 days" / "from last week" / "more than a week old" | `--older-than 7d` |
| "older than 3 days" | `--older-than 3d` |
| "older than 24 hours" | `--older-than 24h` |
| "last 30 minutes" | `--older-than 30m` |
| "everything" / "all finished" / "clean all" | `--all` |
| "run abc123" / specific run ID | `--run-id abc123` |
| "fleet xyz" / fleet ID | `--fleet-id xyz` |
| "workspace ws_123" / workspace ID | `--workspace-id ws_123` |

If the user gave a filter in their prompt, apply it directly — don't re-ask. For example:
- "clean up runs older than 5 days" → `worca cleanup --dry-run --older-than 5d` then confirm
- "remove completed from last 2 days" → `worca cleanup --dry-run --older-than 2d` then confirm
- "clean everything" → `worca cleanup --dry-run --all` then confirm

If no filter was specified, show the dry run output and ask: "Want to clean all of these, or filter by age?"

### Step 3: Confirm and execute

After showing the dry run output, ask for confirmation before actually deleting:

"These N worktrees will be removed. Proceed?"

On confirmation, run the same command without `--dry-run`:

```bash
worca cleanup [filters]
```

Report what was removed.

## CLI reference

```bash
worca cleanup                    # Interactive: list and prompt
worca cleanup --all              # Remove all completed/failed
worca cleanup --run-id <id>      # Remove specific run
worca cleanup --fleet-id <id>    # Remove fleet and children
worca cleanup --workspace-id <id> # Remove workspace and children
worca cleanup --older-than 7d    # Filter by age (7d, 24h, 30m)
worca cleanup --dry-run          # Preview only
```

Filters can be combined: `worca cleanup --older-than 7d --dry-run`

## Important notes

- Running worktrees are never eligible for cleanup — only completed or failed runs.
- Always dry-run first. Worktree deletion is irreversible — uncommitted work in a worktree is lost.
- If `worca` is not on PATH, tell the user to install it (`pip install worca-cc`).
- The user can also see worktrees via `git worktree list`.
