# W-077: Relocate `.claude/worca/` to `~/.worca/pkg/`

**Status:** Draft
**Priority:** P1
**Area:** cc
**Date:** 2026-07-07
**Depends on:** None

## Problem

`worca init` copies ~200 files into `.claude/worca/` inside every consumer project (`src/worca/cli/init.py:831`, `_copy_worca_source`). This pollutes the project tree with worca runtime code and requires `.gitignore` maintenance for `.worca/`, `logs/`, and `.claude/settings.local.json` (`init.py:973`). The code copy is largely redundant when worca is pip-installed — `run_pipeline.py:11` and `run_worktree.py:25` already import via the pip package, not `.claude/worca/`.

User-facing impact: every worca-enabled project carries a ~200-file subtree that has nothing to do with the project's own code, and upgrading requires `worca init --upgrade` to re-copy the entire tree into each project individually.

## Proposal

Move the worca code copy from `.claude/worca/` to a versioned, shared directory at `~/.worca/pkg/<version>/worca/`. Move worca configuration from `.claude/settings.json` to `~/.worca/projects/<slug>/config.json`. Rewrite hook commands to reference the centralized pkg via fully resolved absolute paths. Multiple projects can share the same pkg version; per-project version isolation is maintained via the project registry.

## Architectural Context

### Confirmed decisions

- **Hook path resolution:** Hook commands use fully resolved absolute paths (via `os.path.expanduser("~")` at init time) with no shell env vars (`$HOME`, etc.) — ensures cross-platform compatibility (Linux/macOS/WSL2/Windows) without shell expansion fragility — referenced by Phase 1.
- **Config loading precedence:** `WORCA_CONFIG_PATH` (base) → `WORCA_SETTINGS_PATH` (template overlay) → `.local.json` (secrets merge). The existing `WORCA_SETTINGS_PATH` role (template-merged overlay set by orchestrator) is unchanged; `WORCA_CONFIG_PATH` is the new base layer — referenced by Phase 2.
- **Version key format:** `<semver>-<git-short-hash>` (e.g., `0.59.0-a1b2c3d`) — enables distinguishing between released versions and dev/editable-install builds from different commits — referenced by Phase 1.
- **GC safety:** Mark-and-sweep GC must never remove a pkg version while any pipeline referencing it is running. Implementation deferred to Phase 4 — checks `pipelines.d/` across all registered projects before deletion — referenced by Phase 4.

### Open decisions

None.

## Design

### 1. Centralized Package Store (`~/.worca/pkg/`)

- **Current state:** `init.py:831` copies the worca source tree to `<project>/.claude/worca/`.
- **Obstacle:** Every project carries its own copy; upgrades touch every project.
- **Resolution:** Copy to `~/.worca/pkg/<version>/worca/` instead. Version key format: `<semver>-<git-short-hash>` (e.g., `0.59.0-a1b2c3d`). The `worca/` wrapper directory preserves the import structure — `sys.path.insert` going up two levels from `claude_hooks/` reaches `~/.worca/pkg/<ver>/` where `worca` is an importable package. Copy is idempotent: if the pkg dir already exists, skip.

```
~/.worca/pkg/
  0.59.0-a1b2c3d/
    worca/                     # code copy (same content as current .claude/worca/)
      __init__.py
      claude_hooks/
      hooks/
      orchestrator/
      agents/core/
      schemas/
      scripts/
      events/
      state/
      utils/
    provenance.json            # install metadata (version, source, commit, branch)
```

`provenance.json` stays with the pkg (describes the code copy, not the project). Written by `_write_provenance_manifest()` (`init.py:746`).

### 2. Hook Command Rewrite

- **Current state:** Hook commands in `.claude/settings.json` use `$(git rev-parse --git-common-dir)/.claude/worca/claude_hooks/{script}` (`init.py:362`).
- **Obstacle:** Hooks must reference code that no longer lives in the project.
- **Resolution:** Resolve the absolute path at init time using `os.path.expanduser("~")` and write a plain absolute path into the hook command. No shell expansion needed — works on Linux, macOS, WSL2, and Windows without platform-specific env vars (`$HOME` vs `%USERPROFILE%`).

Before:
```json
{
  "command": "python3 \"$(cd \"$(git rev-parse --git-common-dir)/..\" && pwd)/.claude/worca/claude_hooks/pre_tool_use.py\""
}
```

After:
```json
{
  "command": "python3 /home/user/.worca/pkg/0.59.0-a1b2c3d/worca/claude_hooks/pre_tool_use.py"
}
```

The `_hook_cmd_tpl` template in `init.py:362` changes to use `os.path.expanduser("~")` resolved at init time, producing a fully resolved absolute path. No `$HOME` or shell subshell in the command string.

### 3. Worca Config Relocation

- **Current state:** Worca configuration (`worca.*` namespace) lives in `.claude/settings.json` alongside Claude Code settings (hooks, permissions). `load_settings()` (`utils/settings.py:79`) reads from `.claude/settings.json` + `.local` merge.
- **Obstacle:** Mixing worca config and Claude Code settings in one file prevents minimizing the project footprint.
- **Resolution:** Move worca config to `~/.worca/projects/<slug>/config.json`. `.claude/settings.json` retains only hooks and Claude Code permissions.

```
~/.worca/projects/my-project/
  config.json                  # worca configuration (stages, agents, flow, governance, etc.)
```

New env var `WORCA_CONFIG_PATH` (set by orchestrator at pipeline start) points to the resolved absolute path. Separate from existing `WORCA_SETTINGS_PATH` (template-merged overlay role, unchanged).

Config loading order in `load_settings()`:
1. `WORCA_CONFIG_PATH` → `~/.worca/projects/<slug>/config.json` (base worca config)
2. `WORCA_SETTINGS_PATH` → template-merged overlay (if pipeline active)
3. `.claude/settings.local.json` → secrets merge

Hook scripts read config via `WORCA_CONFIG_PATH`. Orchestrator resolves the path from the registry at startup, exports it before spawning Claude.

### 4. Extended Project Registry

- **Current state:** `~/.worca/projects.d/<slug>.json` contains `name`, `path`, `worcaDir`, `settingsPath` (`project_registry.py:62`).
- **Obstacle:** Registry doesn't track worca version or config path.
- **Resolution:** Add `worcaConfigPath` and `worcaPkgVersion` fields.

```json
{
  "name": "my-project",
  "path": "/abs/path/to/project",
  "worcaDir": "/abs/path/.worca",
  "settingsPath": "/abs/path/.claude/settings.json",
  "worcaConfigPath": "/home/user/.worca/projects/my-project/config.json",
  "worcaPkgVersion": "0.59.0-a1b2c3d"
}
```

UI server reads worca config from `worcaConfigPath`, Claude Code settings from `settingsPath`.

### 5. Worktree Run Support

- **Current state:** Worktrees inherit `.claude/worca/` from the repo tree. `run_worktree.py:427` creates `.worca/` in the worktree.
- **Obstacle:** `.claude/worca/` no longer exists in the project.
- **Resolution:** Hook commands use resolved absolute paths (via `os.path.expanduser("~")` at init time) — they resolve correctly from any worktree. No code copy into worktree needed. `_require_project_worca()` (`cli/main.py:40`) changes to verify the pkg path from the registry instead of checking `.claude/worca/`.

### 6. Mark-and-Sweep GC for Orphan Versions

- **Current state:** No version management — each project has its own copy.
- **Obstacle:** Shared pkg store accumulates old versions when projects upgrade.
- **Resolution:** Mark-and-sweep GC:
  1. Scan all `~/.worca/projects.d/*.json` → collect referenced `worcaPkgVersion` values
  2. List all dirs in `~/.worca/pkg/`
  3. Delete unreferenced dirs
  4. `--dry-run` to preview, `--keep-latest N` to preserve N most recent regardless

Triggers:
- Automatically during `worca init --upgrade` (after switching project to new version)
- On-demand via `worca cleanup --gc`

### 7. What Stays in the Project

```
<project>/
  .claude/
    settings.json              # hooks-only (~30 lines) + Claude Code permissions
    settings.local.json        # secrets (existing, gitignored)
    agents/                    # user agent overrides (existing)
    skills/                    # worca-installed skills (Claude Code requires this location)
    templates/                 # project pipeline templates (existing)
  .worca/                      # run state (existing, gitignored, unchanged)
    runs/<run_id>/
    pipelines.d/
    logs/
```

## Implementation Plan

### Phase 1: Package Store + Hook Rewrite

**What to build:** Relocate the worca code copy from `.claude/worca/` to a versioned shared directory at `~/.worca/pkg/<version>/worca/`. Rewrite hook commands to reference the centralized pkg via fully resolved absolute paths (no shell vars). Update init to verify pkg existence instead of checking project-local `.claude/worca/`.

**Acceptance criteria:**
- [ ] `worca init` creates `~/.worca/pkg/<semver>-<hash>/worca/` with code copy and `provenance.json` (verify: `ls -la ~/.worca/pkg/` shows version dir, `cat ~/.worca/pkg/<ver>/provenance.json` exists)
- [ ] Hook commands in `.claude/settings.json` use plain absolute paths (no `$HOME`, no shell subshells) (verify: `jq '.hooks' .claude/settings.json` shows absolute paths starting with `/`)
- [ ] `worca init` on a second project sharing the same worca version skips pkg copy (idempotent) (verify: run `worca init` twice, second run logs "Package already exists" or equivalent)
- [ ] `_require_project_worca()` verifies pkg path from registry instead of checking `.claude/worca/` (verify: unit test passes, or trigger error with missing pkg and observe error message references registry)

**Files:** `src/worca/cli/init.py`, `src/worca/settings.json`, `src/worca/cli/main.py`, `src/worca/utils/paths.py`, `src/worca/utils/pkg_store.py` (new)
**Tasks:**
1. Create `pkg_store.py` with version key computation (semver + git short hash) and pkg dir management helpers
2. Add `pkg_dir()` and `project_config_dir()` helper functions in `utils/paths.py`
3. Change `_copy_worca_source()` target from `.claude/worca/` to `~/.worca/pkg/<ver>/worca/` with idempotency check (calls `pkg_store.py` for version key)
4. Move `_write_provenance_manifest()` to write `~/.worca/pkg/<ver>/provenance.json`
5. Update `_hook_cmd_tpl` to resolve absolute path via `os.path.expanduser("~")` at init time (produces plain absolute path with no `$HOME` or shell subshell)
6. Update `_require_project_worca()` in `cli/main.py` to verify pkg path from registry
7. Update settings.json template to remove worca code path references
8. Tests: verify init creates pkg in `~/.worca/pkg/`, hooks reference correct path

### Phase 2: Config Relocation

**What to build:** Move worca configuration from `.claude/settings.json` (worca.* namespace) to `~/.worca/projects/<slug>/config.json`. Orchestrator and hooks read config via `WORCA_CONFIG_PATH` env var. `.claude/settings.json` retains only hooks and Claude Code permissions.

**Acceptance criteria:**
- [ ] `worca init` creates `~/.worca/projects/<slug>/config.json` with worca.* keys extracted from settings template
- [ ] `.claude/settings.json` contains only hooks and permissions (no worca.* keys)
- [ ] `run_pipeline.py` exports `WORCA_CONFIG_PATH` pointing to `~/.worca/projects/<slug>/config.json`
- [ ] Hook scripts read config from `WORCA_CONFIG_PATH` instead of `.claude/settings.json`
- [ ] A test pipeline run loads config from the new location (verify via config value read)

**Files:** `src/worca/utils/settings.py`, `src/worca/hooks/tracking.py`, `src/worca/hooks/guard.py`, `src/worca/claude_hooks/post_tool_use.py`, `src/worca/hooks/graphify_nudge.py`, `src/worca/orchestrator/runner.py`, `src/worca/scripts/run_pipeline.py`, `src/worca/scripts/run_worktree.py`, `src/worca/cli/init.py`
**Tasks:**
1. Add `WORCA_CONFIG_PATH` resolution in `load_settings()`
2. Update `init.py` to create `~/.worca/projects/<slug>/config.json` during init (extract worca.* keys from settings template)
3. Update `run_pipeline.py` to resolve and export `WORCA_CONFIG_PATH` at startup
4. Update `run_worktree.py` to propagate `WORCA_CONFIG_PATH`
5. Update hook config readers (`tracking.py`, `guard.py`, `post_tool_use.py`, `graphify_nudge.py`) to use `WORCA_CONFIG_PATH`
6. Strip worca.* keys from `.claude/settings.json` template (leave only hooks + permissions)
7. Tests: verify config loaded from new location, hooks read correct config

### Phase 3: Registry Extension + UI

**What to build:** Extend the project registry to include `worcaConfigPath` and `worcaPkgVersion` fields. Update the worca-ui server to read worca config from the new location instead of `.claude/settings.json`.

**Acceptance criteria:**
- [ ] Registry entries include `worcaConfigPath` and `worcaPkgVersion` fields
- [ ] `worca init` writes both fields when creating or updating registry entries
- [ ] worca-ui server reads worca config from `worcaConfigPath` (not `settingsPath`)
- [ ] worca-ui settings view displays config from the new location

**Files:** `src/worca/utils/project_registry.py`, `worca-ui/server/project-registry.js`, `worca-ui/server/app.js`
**Tasks:**
1. Add `worcaConfigPath` and `worcaPkgVersion` to registry entries
2. Update `auto_register_project()` to write new fields
3. Update UI server `readProjects()` to read `worcaConfigPath`
4. Update UI server settings reads to use `worcaConfigPath` for worca config
5. Tests: verify registry entries, UI reads config from new location

### Phase 4: Upgrade Migration + GC

**What to build:** Detect old-layout projects (`.claude/worca/` exists) during `--upgrade`, migrate to new layout (relocate code to pkg, move config, rewrite hooks, delete `.claude/worca/`). Add `worca cleanup --gc` to remove unreferenced pkg versions via mark-and-sweep.

**Acceptance criteria:**
- [ ] `worca init --upgrade` on old-layout project relocates `.claude/worca/` → `~/.worca/pkg/<ver>/worca/`
- [ ] Old `.claude/worca/` directory is deleted after migration
- [ ] Hooks in `.claude/settings.json` are rewritten to reference new pkg path
- [ ] worca config is moved from `.claude/settings.json` to `~/.worca/projects/<slug>/config.json`
- [ ] `worca cleanup --gc` removes unreferenced pkg versions
- [ ] `worca cleanup --gc` skips pkg versions referenced by running pipelines (verify by running pipeline, triggering GC, checking pkg still exists)
- [ ] `worca cleanup --gc --dry-run` lists versions to remove without deleting
- [ ] `worca cleanup --gc --keep-latest 2` preserves 2 most recent versions regardless of references
- [ ] GC runs automatically after `--upgrade` completes

**Files:** `src/worca/cli/init.py`, `src/worca/cli/cleanup.py`, `src/worca/utils/pkg_store.py`
**Tasks:**
1. In `--upgrade` flow: detect `.claude/worca/` (old layout), relocate to pkg, move config, rewrite hooks, delete `.claude/worca/`
2. Add mark-and-sweep GC logic to `pkg_store.py` (scan registry for referenced versions, list pkg dirs, compute orphans, check running pipelines)
3. Add `worca cleanup --gc` subcommand in `cleanup.py` with `--dry-run` and `--keep-latest N` options (calls `pkg_store.py` GC logic)
4. Auto-trigger GC after `--upgrade` completes
5. Tests: verify migration from old layout, GC removes unreferenced versions, GC skips versions referenced by running pipelines

### Phase 5: Fleet/Workspace/Script Updates

**What to build:** Update fleet and workspace runners to propagate `WORCA_CONFIG_PATH` to child runs. Verify event emitters resolve webhook config from the new config path.

**Acceptance criteria:**
- [ ] Fleet child runs receive `WORCA_CONFIG_PATH` in their environment
- [ ] Workspace child runs receive `WORCA_CONFIG_PATH` in their environment
- [ ] Event emitters read webhook config from `WORCA_CONFIG_PATH` (not `.claude/settings.json`)
- [ ] A fleet run with webhook config successfully emits events to configured endpoint

**Files:** `src/worca/scripts/run_fleet.py`, `src/worca/scripts/run_workspace.py`, `src/worca/events/emitter.py`
**Tasks:**
1. Update fleet runner to propagate `WORCA_CONFIG_PATH` to child runs
2. Update workspace runner to propagate `WORCA_CONFIG_PATH` to child runs
3. Verify event emitters resolve webhook config from new config path
4. Tests: fleet and workspace runs use relocated config

### Files Changed Summary

| File | Change |
|------|--------|
| `src/worca/cli/init.py` | Pkg store target, hook template, config creation, migration logic |
| `src/worca/cli/main.py` | `_require_project_worca()` checks pkg path |
| `src/worca/cli/cleanup.py` | Add `--gc` subcommand |
| `src/worca/utils/settings.py` | `WORCA_CONFIG_PATH` resolution in `load_settings()` |
| `src/worca/utils/project_registry.py` | Extended registry fields |
| `src/worca/utils/paths.py` | Add `pkg_dir()`, `project_config_dir()` helpers |
| `src/worca/utils/pkg_store.py` | New — version key computation, pkg dir management, mark-and-sweep GC logic |
| `src/worca/hooks/tracking.py` | Config discovery via `WORCA_CONFIG_PATH` |
| `src/worca/hooks/guard.py` | Config read from new path |
| `src/worca/claude_hooks/post_tool_use.py` | Config read from new path |
| `src/worca/hooks/graphify_nudge.py` | Config read from new path |
| `src/worca/orchestrator/runner.py` | Export `WORCA_CONFIG_PATH`, read from new path |
| `src/worca/scripts/run_pipeline.py` | Resolve and export `WORCA_CONFIG_PATH` |
| `src/worca/scripts/run_worktree.py` | Propagate `WORCA_CONFIG_PATH` |
| `src/worca/scripts/run_fleet.py` | Propagate `WORCA_CONFIG_PATH` |
| `src/worca/scripts/run_workspace.py` | Propagate `WORCA_CONFIG_PATH` |
| `src/worca/settings.json` | Hook command template updated |
| `worca-ui/server/project-registry.js` | Read extended registry fields |
| `worca-ui/server/app.js` | Read config from `worcaConfigPath` |

## Considerations

- **Breaking change:** `worca init --upgrade` on existing projects will migrate layout. First upgrade after this change removes `.claude/worca/`. No rollback without re-running old `worca init`.
- **Migration:** old layout (`.claude/worca/` exists) → detected during `--upgrade` → automatic relocation. No user action beyond running `--upgrade`.
- **Governance:** Hook commands change from project-relative to fully resolved absolute paths (no `$HOME` shell var). Dispatch governance config moves to `~/.worca/projects/<slug>/config.json`. `worca-dispatch-governance-reviewer` subagent should be dispatched after implementation.
- **Platform:** Hook commands use fully resolved absolute paths (via `os.path.expanduser("~")` at init time). No shell env var expansion needed — works on Linux, macOS, WSL2, and Windows without platform-specific handling.
- **Worktree isolation:** worktrees share the centralized pkg. If a user upgrades worca while a worktree pipeline is running, the running pipeline's hooks would reference the old version (still on disk until GC). GC should never remove a version while any pipeline is running — check `pipelines.d/` across all registered projects.
- **Slug collision:** deferred. Two projects with identical basenames will collide in `projects.d/`. Mitigation: warn at init time. Future: `--name <custom-slug>` flag on `worca init` to override the auto-derived slug.

## Test Plan

### Unit Tests

| Layer | Test | Validates |
|-------|------|-----------|
| Python | `test_init_creates_pkg_in_home` | `worca init` copies to `~/.worca/pkg/<ver>/worca/` |
| Python | `test_init_idempotent_pkg_exists` | Skip copy if pkg dir already exists |
| Python | `test_hook_command_uses_absolute_path` | Hook commands reference resolved absolute path to `~/.worca/pkg/...` |
| Python | `test_config_created_in_projects_dir` | `config.json` created at `~/.worca/projects/<slug>/` |
| Python | `test_load_settings_reads_worca_config_path` | `WORCA_CONFIG_PATH` env var respected |
| Python | `test_registry_extended_fields` | Registry entries include `worcaConfigPath`, `worcaPkgVersion` |
| Python | `test_gc_removes_unreferenced_versions` | Mark-and-sweep deletes orphan pkg dirs |
| Python | `test_gc_keeps_referenced_versions` | Referenced versions survive GC |
| Python | `test_gc_skips_running_pipeline_versions` | GC skips pkg versions referenced by running pipelines (checks `pipelines.d/`) |
| Python | `test_gc_dry_run` | Dry run lists but doesn't delete |
| Python | `test_gc_keep_latest_n` | `--keep-latest N` preserves N most recent versions regardless of references |
| Python | `test_upgrade_migrates_old_layout` | `.claude/worca/` detected, relocated, deleted |
| Python | `test_version_key_format` | Semver + short hash computed correctly |

### Integration Tests

- Full `worca init` → verify no `.claude/worca/` created, pkg in `~/.worca/pkg/`
- `worca init --upgrade` on old-layout project → verify migration
- Pipeline run with relocated config → verify hooks fire, config loaded
- Worktree run → verify hooks resolve from shared pkg
- GC after upgrade → verify old version removed

### Existing Tests to Update

- `tests/test_worca_cli.py` — init tests reference `.claude/worca/` paths
- `tests/integration/conftest.py` — fixture creates `.claude/worca/` → update to new layout
- `tests/integration/test_file_access_integration.py` — path assumptions
- Any test mocking `load_settings()` path resolution

### Done Criteria

All unit tests listed in the Unit Tests table pass. All integration scenarios listed in Integration Tests section pass. All updated tests in Existing Tests to Update section pass on CI.

## Files to Create/Modify

See Files Changed Summary in Implementation Plan (includes both modifications and new file creation).

## Out of Scope

- `--name <custom-slug>` flag for `worca init` (slug collision mitigation) — deferred to a follow-up. When implemented, `worca init --name <slug>` will override the auto-derived slug from `os.path.basename(project_root)`, allowing two projects with identical basenames to coexist in the registry.
- Relocating `.worca/` run state directory — stays in project (already gitignored)
- Relocating `.claude/agents/`, `.claude/skills/`, `.claude/templates/` — stay in project (Claude Code convention, user-editable)
- Relocating `.claude/settings.local.json` — stays in project (Claude Code native secrets mechanism)
- pip post-install hooks to auto-populate pkg store
- XDG-compliant directory layout (`$XDG_DATA_HOME` etc.)
