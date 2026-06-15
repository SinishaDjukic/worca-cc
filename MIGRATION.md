# Migrating worca-cc

## TL;DR

| Step | Command | Notes |
|------|---------|-------|
| 1. Upgrade package | `pip install --upgrade worca-cc==X.Y.Z` | Updates the Python package |
| 2. Refresh runtime | `cd <project> && worca init --upgrade` | Migrates settings, copies new runtime |
| 3. Manual cleanup | See [What you must delete manually](#what-you-must-delete-manually) | Only needed for projects that pre-date v0.6.0 packaging |

## How upgrades work

1. **`pip install --upgrade worca-cc==X.Y.Z`** updates the Python package globally (or in your venv). This does not touch any project files.

2. **`worca init --upgrade`** (run inside each project) refreshes the `.claude/worca/` runtime copy and migrates settings. Run this in every project that uses worca.

3. **Manual cleanup** may be required for projects that were initially set up before the v0.6.0 packaging migration (i.e., when worca files lived directly in `.claude/hooks/`, `.claude/scripts/`, etc.).

### Why manual cleanup is sometimes needed

`worca init --upgrade` includes a one-shot legacy cleanup function (`_cleanup_legacy_files` in `src/worca/cli/init.py`). However, this cleanup **only runs when `.claude/worca/__init__.py` has no `__version__` string** — meaning the project was set up via the old copy-paste method, not from a pip package.

Once a project has been upgraded to a versioned (packaged) install, the version check gate (`read_version(worca_dir) is not None`) causes the cleanup to be skipped on all subsequent upgrades. Legacy directories left behind by a previous pre-packaging install will persist silently.

## What `worca init --upgrade` handles automatically

### Settings path migrations

These old paths in `settings.json` are rewritten to their new locations:

| Old path | New path |
|----------|----------|
| `.claude/hooks/pre_tool_use.py` | `.claude/worca/claude_hooks/pre_tool_use.py` |
| `.claude/hooks/post_tool_use.py` | `.claude/worca/claude_hooks/post_tool_use.py` |
| `.claude/hooks/user_prompt_submit.py` | `.claude/worca/claude_hooks/user_prompt_submit.py` |
| `.claude/scripts/preflight_checks.py` | `.claude/worca/scripts/preflight_checks.py` |

Source: `_PATH_MIGRATIONS` in `src/worca/cli/init.py:108-118`.

### Settings key migrations

| Setting | Old value | New value | Context |
|---------|-----------|-----------|---------|
| `worca.stages.review.agent` | `guardian` | `reviewer` | W-037 agent rename |
| `worca.agent_overrides_dir` | `.claude/agents/overrides` | `.claude/agents` | Override dir flattening |

### Agent override directory migration

Override files are moved from `.claude/agents/overrides/*.md` to `.claude/agents/*.md` (flat). The empty `overrides/` directory is removed if no user files remain.

### Runtime copy

The entire `.claude/worca/` directory is replaced with a fresh copy from the installed package (excluding `cli/` and `__pycache__/`).

### Settings deep-merge

New default keys from the package's `src/worca/settings.json` are merged into the project's `.claude/settings.json` **non-destructively**: missing keys are added, but existing user values are preserved. This means user-chosen agent models (`worca.agents.<name>.model`), custom `permissions.allow` entries, webhooks, loop counts, and other tuned values survive `--upgrade`.

Forward-incompatible renames (e.g. `stages.review.agent: guardian -> reviewer` in W-037) are applied explicitly via `_migrate_settings_paths` *before* the merge, so they land deterministically and show up under `worca init --check`.

If you want to hard-reset your settings to the current template, use `worca init --force` (destructive). Project-specific overrides that should never be touched by any upgrade still belong in `.claude/settings.local.json`.

### Built-in model aliases are force-synced

The three built-in model aliases — `worca.models.opus`, `worca.models.sonnet`, `worca.models.haiku` — are the **exception** to the non-destructive merge above. They track the *installation*, not the project: every `worca init --upgrade` overwrites them with the package's current values (e.g. bumping `opus` to a new Opus model on release). Any project-level customization of these three — including an `{id, env}` alt-endpoint routing block — is **discarded** on upgrade. The change is reported in the upgrade output and previewable under `worca init --check`.

If you need custom model routing, define it under a **differently-named alias** (e.g. `opus-alt`) and point the relevant `worca.agents.<name>.model` at it — user-added aliases are preserved verbatim. Source: `_reconcile_builtin_models` / `_BUILTIN_MODEL_ALIASES` in `src/worca/cli/init.py`.

### Global key extraction (W-049)

Four settings keys that are naturally global (apply across all projects) are extracted from `.claude/settings.json` into `~/.worca/settings.json`:

| Key (under `worca.`) | Default | Scope after migration |
|---|---|---|
| `parallel.cleanup_policy` | `never` | Global (`~/.worca/settings.json`) |
| `parallel.max_concurrent_pipelines` | `10` | Global |
| `ui.worktree_disk_warning_bytes` | `2000000000` | Global |
| `circuit_breaker.classifier_model` | `haiku` | Global |

If `~/.worca/settings.json` does not exist, it is created. Existing values in the global file are preserved (project values merge in). After extraction, the keys are removed from the project file.

Idempotent: runs silently on second invocation.

Source: `_migrate_global_keys_to_preferences` in `src/worca/cli/init.py`.

### Inert milestone key stripping (W-049)

`pr_approval` and `deploy_approval` under `worca.milestones` are removed from `.claude/settings.json` **if and only if** their value is exactly `true` (the old template default). Any other value (`false`, a string, etc.) is left alone as an intentional user override.

Why: these keys were inert before W-049 — the runner ignored them. After W-049, the runner gates on `pr_approval is True`, so leaving the template default in place would activate the PR-creation approval gate on every upgraded project, hanging autonomous flows.

Stripping the default lets the runner's missing-key behavior (`false`) take effect, keeping the gate opt-in.

If both keys are removed and `worca.milestones` becomes empty, the empty object is cleaned up.

Idempotent: runs silently on second invocation.

Source: `_strip_inert_milestone_keys` in `src/worca/cli/init.py`.

### .gitignore entries

These entries are added if missing: `.worca/`, `logs/`, `.claude/settings.local.json`.

### Beads

- `.beads/` is initialized if it doesn't exist.
- The beads repo fingerprint is updated on upgrade (`bd migrate --update-repo-id`).

### One-shot legacy cleanup (pre-packaging installs only)

On the **first** upgrade from a pre-packaging install (no version in `.claude/worca/__init__.py`), these are automatically removed:

- `.claude/hooks/` — files: `__init__.py`, `post_tool_use.py`, `pre_compact.py`, `pre_tool_use.py`, `session_end.py`, `session_start.py`, `stop.py`, `subagent_start.py`, `subagent_stop.py`, `user_prompt_submit.py`
- `.claude/scripts/` — files: `__init__.py`, `preflight_checks.py`, `run_batch.py`, `run_learn.py`, `run_multi.py`, `run_parallel.py`, `run_pipeline.py`, `worca.py`
- `.claude/agents/core/` — files: `coordinator.md`, `guardian.md`, `implementer.md`, `learner.md`, `plan_reviewer.md`, `planner.md`, `tester.md`
- `.claude/agents/domain/` — removed if it only contains `.gitkeep` and/or `.DS_Store`
- `.claude/worca-ui/` — entire directory

## What you must delete manually

If your project was set up before v0.6.0 and has since been upgraded past the version gate, the following directories and files may still exist. **None of them are read by any current code path** — they are safe to delete.

Run `worca init --check` first as a dry-run to see what the upgrade tool would do, then use the table below to identify leftover files.

### Obsolete files inventory

| Path | Replaced by | Still read by any code? | Safe to delete |
|------|-------------|------------------------|----------------|
| `.claude/hooks/` | `.claude/worca/claude_hooks/` | No — `settings.json` points to `.claude/worca/claude_hooks/` | Yes |
| `.claude/scripts/` | `.claude/worca/scripts/` | No — `settings.json` and CLI entry points use the packaged paths | Yes |
| `.claude/worca-ui/` | `@worca/ui` npm package (install globally) or the `worca-ui/` directory in the source repo | No — the embedded UI was fully removed | Yes |
| `.claude/agents/core/*.md` | `.claude/worca/agents/core/` (runtime copy from package) | No — see explanation below | Yes |
| `.claude/agents/domain/` | Nothing (empty scaffolding leftover) | No | Yes |
| `.claude/agents/overrides/` | `.claude/agents/` (flat, no subdirectory) | No — `agent_overrides_dir` defaults to `.claude/agents` | Yes |
| `__pycache__/` dirs inside any of the above | N/A | No | Yes |

### Why `.claude/agents/core/*.md` files are dead

This is the most confusing leftover. Three different `agents/core/` paths exist:

1. **`src/worca/agents/core/`** — the canonical templates in the pip package source tree.
2. **`.claude/worca/agents/core/`** — the runtime copy created by `worca init`. This is what the pipeline reads at runtime (`runner.py:257`).
3. **`.claude/agents/core/`** — the **old** pre-packaging location. **Nothing reads from here.**

The runtime (`runner.py`) resolves agent templates from `.claude/worca/agents/core/` only. Agent overrides live flat in `.claude/agents/<agent>.md` (no `core/` subdirectory). Claude Code's subagent discovery scans `.claude/agents/` flat — it does not recurse into `core/`.

Files in `.claude/agents/core/` are neither templates nor overrides. They are inert.

### Consolidated cleanup command

After verifying with `worca init --check`, run this from your project root:

```bash
cd .claude
rm -rf hooks/ scripts/ worca-ui/ agents/domain/ agents/overrides/
rm -f agents/core/coordinator.md agents/core/guardian.md agents/core/implementer.md \
     agents/core/learner.md agents/core/plan_reviewer.md agents/core/planner.md \
     agents/core/tester.md agents/core/reviewer.md
rmdir agents/core 2>/dev/null || true
find . -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null || true
```

If `.claude/agents/core/` contains files you do not recognize (not in the list above), investigate before deleting — they may be custom files you created.

## Where overrides go now

| Type | Location | Example |
|------|----------|---------|
| Per-project agent override | `.claude/agents/<agent>.md` | `.claude/agents/implementer.md` |
| Per-project block override | `.claude/agents/<block>.block.md` | `.claude/agents/implement.block.md` |

Override modes:

- **Replace** (default): the override file replaces the base prompt entirely. No tag needed, or use `<!-- replace -->` explicitly.
- **Append** (`<!-- append -->`): sections are merged into the base using section-level merge. Use `## Override: <Section Name>` headings to target specific sections.
- **Governance protection**: sections marked `<!-- governance -->` in the base cannot be replaced by overrides (demoted to append with a warning).

For details, see the `/worca-agent-override` skill or `src/worca/orchestrator/overlay.py`.

## Verifying the upgrade

After upgrading and cleaning up, run these checks:

```bash
# 1. Dry-run check for drift
worca init --check

# 2. Verify .claude/ directory structure
ls .claude/
# Expected: agents/  settings.json  skills/  templates/  worca/
# Optional: settings.local.json  worktrees/

# 3. Confirm runtime version matches installed package
grep __version__ .claude/worca/__init__.py
python -c "import worca; print(worca.__version__)"
# Both should print the same version

# 4. Check settings.json has no stale paths
grep -c '.claude/hooks/' .claude/settings.json    # should be 0
grep -c '.claude/scripts/' .claude/settings.json  # should be 0 (except .claude/worca/scripts/ which is correct)
```

## Version-specific notes

### 0.5.0 → 0.6.0

The packaging migration. This is the release that moved pipeline code from `.claude/` into the `src/worca/` pip package.

- Agent templates moved from `.claude/agents/core/` to `src/worca/agents/core/` (runtime copy at `.claude/worca/agents/core/`)
- Hook scripts moved from `.claude/hooks/` to `src/worca/claude_hooks/`
- Agent overrides directory simplified from `.claude/agents/overrides/` to `.claude/agents/` (flat)
- `release.yml` merged into `release-pypi.yml`
- **Manual cleanup required** for projects that pre-date this release — see [What you must delete manually](#what-you-must-delete-manually)

### 0.6.x → 0.7.0

- Usage object logging added with model-specific pricing
- `DEFAULT_PRICING` removed from UI; pricing now sourced from `settings.json`
- Beads fingerprint upgrade added to `worca init`

### 0.7.0 → 0.8.0

- Pipeline templates system added (W-016)
- No path or settings migrations required

### 0.8.0 → 0.9.0

- Template agent prompt overrides wired through overlay resolver
- `milestones.plan_approval=false` now correctly auto-approves plans
- `pipeline.pid` moved to per-run directories for concurrent pipeline support

### 0.9.0 → 0.10.0+

- W-037: Agent prompts extracted into composable block files
- `stages.review.agent` renamed from `guardian` to `reviewer` (auto-migrated by `worca init --upgrade`)

### 0.15.x → 0.16.0

W-043: Unified pipeline state model and universal event dispatch.

**Breaking changes:**

1. **Terminal state for user-stop unified to `interrupted`** — Previously, stopping a running pipeline via the UI wrote `pipeline_status: "failed"`. Now all stop paths (control-file, webhook, signal) produce `"interrupted"` with a discriminating `stop_reason` (`control_file`, `control_webhook`, `signal`, `force_cancelled`). Code that checks for `"failed"` to detect user-initiated stops must now check for `"interrupted"` instead.

2. **`POST /runs/:id/stop` rejects dead-PID with 409** — If the pipeline process is no longer alive but `pipeline_status` is still `running` or `paused`, the stop endpoint now returns `409 { code: "no_running_process", suggested_action: "cancel" }` instead of silently rewriting the status. Use the cancel endpoint to clean up dead runs.

3. **`DELETE /runs/:id` removed** — The old DELETE alias for stopping a pipeline has been removed. Use `POST /runs/:id/stop` to stop a running pipeline. A new `POST /runs/:id/delete` endpoint permanently removes a run directory (refuses if the pipeline is still running).

4. **New `pipeline.run.cancelled` event type** — Cancelling a run via `POST /runs/:id/cancel` now emits a `pipeline.run.cancelled` event through the universal dispatch pipeline (webhooks, integrations). Previously, cancel was a silent status rewrite.

5. **`resuming` pipeline status removed** — The `resuming` status is no longer emitted by any code path. Pipelines go directly from `paused` to `running` on resume. UI components no longer render a `resuming` badge. The legacy `interrupted → paused` status mapping has also been removed — `interrupted` is now a canonical terminal state.

6. **Windows stop semantics** — On Windows, `SIGTERM` does not propagate to child processes. The stop flow now kills the agent subprocess directly via `agent.pid` when `process.platform === 'win32'`.

**No automatic migrations required** — these are runtime behavior changes. Update any external integrations or scripts that depend on the old behavior.

### 0.17.x → 0.18.0

W-048: Worktree-based pipeline isolation and unified run aggregation.

**Breaking changes:**

1. **`active_run` pointer file removed** — `.worca/active_run` is no longer written by any code path. External tools or scripts that read this file will get no data. Replace with scanning `.worca/runs/*/status.json` for non-terminal runs (`pipeline_status` not in `completed`, `failed`, `interrupted`). The stale file is deleted on the next `worca init --upgrade`.

2. **`run_multi.py` and `run_batch.py` removed** — Both batch entry points are gone. Use `run_worktree.py` (one call per pipeline) or a shell loop as a replacement:
   ```bash
   # Old (run_multi.py accepted --requests)
   python .claude/worca/scripts/run_multi.py --requests req1.json req2.json
   # New
   for req in req1.json req2.json; do
     python .claude/worca/scripts/run_worktree.py --source "$req" &
   done
   ```

3. **WebSocket protocol: 5 pipeline-* message types removed** — The `MultiWatcher`-based pipeline subscription protocol has been retired. The following message types are no longer emitted or accepted by the server:
   - `list-pipelines`
   - `subscribe-pipeline`
   - `unsubscribe-pipeline`
   - `pipeline-status-changed`
   - `pipelines-list`

   **Third-party WebSocket subscribers using any of these types will break.** Migrate to the unified run subscription protocol: subscribe via `subscribe-run` (or receive `runs-list` broadcasts) which now includes worktree runs alongside root runs. The `state.pipelines` client-side map is derived from `state.runs` — no separate pipeline subscription needed.

4. **`MultiWatcher` server module removed** — `worca-ui/server/multi-watcher.js` is deleted. If any custom server code references `MultiWatcher`, `WatcherSet#getMultiWatcher`, or `WatcherSet#_createMultiWatcher`, remove those references.

5. **'Pipeline already running' block removed from new-run UI** — Starting a new run no longer fails when a pipeline is already running. Each run spawns in its own isolated git worktree, so multiple concurrent pipelines are supported. External integrations that relied on the `422 Pipeline already running` error from `POST /runs` (or the equivalent WS rejection) must remove that error-handling branch.

**New features / commands:**

- **`run_worktree.py`** — single-pipeline worktree launcher. Creates a git worktree, registers in `pipelines.d/`, and spawns `run_pipeline.py` inside the worktree. Accepts `--prompt`, `--source`, `--plan`, `--branch`, `--guide`, `--fleet-id`.
- **`--guide` flag on `run_pipeline.py`** — Pass a reference guide (repeatable) into the pipeline. Requires W-040 (`attach_guide()`) to be installed; emits a fatal error otherwise rather than silently dropping the content.
- **`worca cleanup`** — Remove completed/failed pipeline worktrees from disk and from the `pipelines.d/` registry. Running worktrees are never eligible. Options: `--all`, `--run-id`, `--dry-run`, `--older-than`.
- **`pipelines.d/` fan-out in `discoverRuns`** — Worktree runs are now visible in the unified runs list alongside root project runs. No UI changes required.

**No automatic migrations required** — these are runtime behavior and protocol changes. Run `worca init --upgrade` once to remove the stale `active_run` file from `.worca/`. Update any external integrations or scripts that depend on the removed batch scripts, WebSocket protocol types, or `active_run` file.

### 0.18.x → 0.19.0

W-049: Settings UI for execution, approval gates, circuit breaker, and worktree disk threshold.

**Default changes:**

| Setting | Old default | New default | Rationale |
|---|---|---|---|
| `cleanup_policy` | `on-success` | `never` | Auto-deletion would silently break worktree inspection workflows |
| `max_concurrent_pipelines` | `3` | `10` | A cap of 3 immediately blocks users with 4+ projects |
| `pr_approval` | `true` (inert) | `false` (active) | Default-true would hang every autonomous run at the PR-creation gate |

**Project/global settings split:**

Four keys move from project-scoped (`.claude/settings.json`) to global-scoped (`~/.worca/settings.json`): `cleanup_policy`, `max_concurrent_pipelines`, `worktree_disk_warning_bytes`, `classifier_model`. The canonical list and defaults live in `src/worca/schemas/keys.json`.

**Automatic migration via `worca init --upgrade`:**

1. Global keys are extracted from the project file into `~/.worca/settings.json` (created if absent).
2. Template-default `pr_approval: true` and `deploy_approval: true` are stripped from the project file to prevent the new PR-approval gate from activating unexpectedly.

Both steps are idempotent. Run output:

```
Migrated 4 key(s) to ~/.worca/settings.json
Reset 2 template-default milestone key(s) (pr_approval, deploy_approval) — gate now opt-in via Pipeline tab
```

**If you skip `worca init --upgrade`:**

The UI's settings editor handles migration automatically. When you open project settings, a banner appears if misplaced global keys or inert milestone defaults are detected. Clicking "Migrate now" (or simply saving settings) triggers the same extraction — the server's save handler auto-migrates on every save. No data is lost; no separate endpoint or manual JSON editing is required.

**New features:**

- Settings UI panels for Execution & Parallelism, Approval Gates, and Circuit Breaker configuration.
- Global Preferences tab (`~/.worca/settings.json`) for cross-project settings (worktree cleanup, concurrency cap, disk threshold, classifier model).
- PR-approval gate: when `worca.milestones.pr_approval` is `true`, the pipeline pauses before PR creation and waits for user approval via the run-detail UI.
- Server-enforced `max_concurrent_pipelines` cap with launch mutex (returns 409 when at capacity).

### 0.19.0 → 0.24.0

Additive features only — no breaking changes. The one required user action is the Python floor bump.

**Required action:**

- **Python 3.10+** — the package floor was raised from 3.8 to 3.10. Ensure your environment matches before upgrading; the package will refuse to install on older interpreters.

**New features:**

- **`/worca-analyze` skill** — end-to-end issue triage (analysis → decisions → issue update → template recommendation → optional worktree launch). Auto-installed into `.claude/skills/worca-analyze/` by `worca init --upgrade`. See the [Issue Triage section in CONTRIBUTING.md](./CONTRIBUTING.md#issue-triage).
- **`worca run --worktree`** — first-class CLI flag to launch a pipeline into an isolated git worktree (parallel-safe). Mirrors the UI's "New Pipeline" path; falls back to in-place if `run_worktree.py` is missing in the project runtime. New companion flags: `--branch` (worktree base branch) and `--guide` (reference guides for the planner, repeatable, requires W-040).
- **`worca templates list --json`** — machine-readable enumeration of all resolvable templates (id, name, description, tier, tags, builtin, created_at) with project > user > built-in tier resolution applied. Used by `/worca-analyze` and external tooling.
- **Multi-host PR metadata (W-051)** — the `pr.json` schema gained `commit_sha`, `source_branch`, `target_branch`, `provider`, and `is_draft` fields. The `pr_url.py` parser detects GitHub, GitLab, Bitbucket, Azure DevOps, and Gitea URL patterns. UI surfaces a collapsible "PR details" subsection on the PR stage card. Webhook subscribers receive the richer `GIT_PR_CREATED` payload automatically — no breaking change to event names.
- **`investigate` template now publishes its plan as a PR (W-046)** — the PR stage is enabled in this template so investigation outputs land as reviewable PRs instead of staying local-only.
- **Coverage runner: `--include-unit-tests`** — opt-in flag on `scripts/coverage.py ci` that wraps the pytest invocation itself with `coverage run --parallel-mode` so unit-test in-process calls are measured alongside integration subprocess fragments. Default off (doubles wall time but produces accurate per-module numbers when needed).

**No automatic migration steps required** — `worca init --upgrade` handles the new skill placement and continues to be idempotent. All settings.json changes are additive.

### 0.24.x → 0.25.0

W-051: Configurable model profiles with per-model environment variables.

- **`worca.models` entries now accept an object form** `{ "id": "model-id", "env": { "KEY": "value" } }` in addition to the existing plain string. Env vars are injected into the subprocess environment when the corresponding agent stage runs. Secrets belong in `settings.local.json` (gitignored). No migration required — purely additive; existing string-form configs continue to work unchanged.

### 0.25.x → 0.28.0

W-040: Fleet runs — cross-repository fan-out of a single work-request.

**New features:**

- **`run_fleet.py`** — new entry point that fans a single work-request out to N independent project repositories in parallel. Each target gets its own isolated pipeline (own git worktree, own branch, own PR), grouped under a shared `fleet_id` in `pipelines.d/`.

  ```bash
  python .claude/worca/scripts/run_fleet.py \
    --projects /path/to/repo-a /path/to/repo-b /path/to/repo-c \
    --prompt "Apply authentication migration"
  ```

- **`--guide PATH`** (repeatable) — attach a normative reference document (migration spec, RFC) that every child's agents treat as the highest-authority source. Paths are resolved to absolute before dispatch. Also now wired into `run_pipeline.py` and `run_parallel.py`. Combined guide content is capped at 64 KB (`worca.guide.max_bytes`).

- **`--head-template TMPL`** — per-child head branch name template. Placeholders: `{project}`, `{fleet_id}`, `{slug}`, `{yyyymmdd}`, `{yyyymmddhhmm}`. If no placeholder is present, `/{project}` is appended automatically to ensure uniqueness across the fleet.

- **`--base BRANCH`** — PR base branch shared across the fleet. When omitted, each child resolves its own default branch. `--branch` is explicitly rejected on `run_fleet.py` — use `--base` and `--head-template` instead.

- **`--plan PATH`** — shared plan file; every child receives it and skips the PLAN stage entirely (recommended for fleet work).

- **`--plan-first [PROJECT]`** — run the Planner on a reference child first; once its `MASTER_PLAN.md` appears it is copied to `~/.worca/fleet-runs/<fleet_id>/shared-plan.md` and all remaining children inherit it. Mutually exclusive with `--plan`.

- **`--max-parallel N`** — maximum concurrent child pipelines (default: 5). Children are dispatched in batches; the fleet-level circuit breaker fires between batches.

- **`--fleet-failure-threshold RATIO`** — failure ratio that trips the circuit breaker and halts unstarted children (default: 0.30). In-flight children are never killed.

- **`--resume FLEET_ID`** — resume a halted or failed fleet by re-launching only failed/pending/setup_failed children. Children that are completed, running, or paused are left alone.

- **`--init-timeout SECONDS`** — per-target `worca init --upgrade` timeout (default: 60). Targets that exceed this are marked `setup_failed` and skipped; the fleet continues.

- **`fleet_id` in `pipelines.d/`** — each child pipeline's registry entry now carries `fleet_id` and `group_type: "fleet"`. The UI reads these fields to group runs under a shared fleet header. Existing entries without `fleet_id` are unaffected.

- **Fleet manifest** — fleet-level state is tracked at `~/.worca/fleet-runs/<fleet_id>.json` (work request, guide paths, plan mode, circuit breaker status, child list). Per-child pipeline state remains in each project's `pipelines.d/` entries — not duplicated.

- **`worca cleanup --fleet-id FLEET_ID`** — remove all child worktrees, their `pipelines.d/` entries, and the fleet manifest directory (including uploaded guides) in one command.

- **Guardian PR titles** — when `fleet_id` is present the Guardian agent prepends `[fleet:<short_id>]` to every PR title, making fleet PRs easy to spot in GitHub's PR list.

**New UI surfaces:**

- **Dashboard fleet grouping** — the worca-ui dashboard groups fleet children under a collapsible fleet header showing an aggregate status badge (blue = running, orange = halted by circuit breaker, green = completed, red = failed), aggregate progress (`N/M completed · K failed`), and a link to the fleet detail view. Requires **global mode** (`pnpm worca:ui` without `--project`).

- **Fleet launcher** (`New Fleet` option in the sidebar dropdown) — form to launch a fleet from the UI: target project multi-select, prompt, guide file upload, plan mode toggle, concurrency settings.

- **Fleet detail view** — per-fleet page listing all children with their individual run status, branch, and PR link.

**New settings:**

```jsonc
"worca": {
  "guide": {
    "max_bytes": 65536          // 64 KB hard cap on combined guide content
  },
  "fleet": {
    "init_timeout_seconds": 60  // per-target worca init --upgrade timeout
  }
}
```

Both keys are additive. Existing installs pick them up as defaults on the next `worca init --upgrade`.

**No automatic migration required.** All changes are additive. Run `worca init --upgrade` once to pull the new `worca.guide.*` and `worca.fleet.*` defaults into your project's `settings.json`.

**Full walkthrough:** [`docs/fleet-runs.md`](./docs/fleet-runs.md).

### 0.28.x → 0.29.0

W-047: Multi-repo coordinated pipelines (workspace runs).

**New features:**

- **`run_workspace.py`** — new entry point that coordinates changes across interdependent repos with dependency-ordered execution. Unlike fleet runs (same prompt to N repos), workspace runs decompose one prompt into repo-specific sub-plans, execute them in DAG tier order, run cross-repo integration tests, and create linked PRs with dependency metadata.

  ```bash
  python .claude/worca/scripts/run_workspace.py /path/to/parent \
    --prompt "Add user authentication across all services"
  ```

- **`worca workspace init`** — scaffolds a `workspace.json` from sibling git repos in a parent directory. Scans child directories for `.git/`, generates the workspace definition with defaults (`depends_on: []`, `role: "service"`), and creates the `.worca/` directory.

  ```bash
  worca workspace init /path/to/parent         # Scan child dirs, create workspace.json
  worca workspace init /path/to/parent --force  # Overwrite existing workspace.json
  ```

- **`workspace.json`** — persistent workspace definition listing repos, their roles, dependency relationships, an optional integration test command, and an optional `umbrella_repo` for the umbrella issue. Lives in the parent directory containing sibling repos.

- **Master planner** — an Opus agent that reads all repos' `CLAUDE.md` files, workspace topology, and the work request, then produces a structured workspace plan with per-repo sub-plans. Skip with `--skip-planning` to let each repo plan independently.

- **DAG executor** — replaces fleet's all-at-once parallel dispatch with tier-based dependency-ordered execution. Repos within the same tier run in parallel (up to `--max-parallel`); tiers execute sequentially. Context artifacts (diff summaries, capped at 8 KB per dependency) are injected as `--guide` files between tiers so downstream repos know what upstream changed.

- **Cross-repo integration test** — after all DAG tiers complete, runs a user-defined `integration_test.command` from `workspace.json`. Creates temporary parallel worktrees for all completed children. On failure, workspace status is set to `integration_failed` and no PRs are created. Skip with `--skip-integration`.

- **Linked PR creation** — each completed child gets a PR titled `[workspace:<ws_short>] <work_title>` with dependency comments (`Depends on: org/lib#15`, `Blocks: org/frontend#43`). An umbrella issue in `umbrella_repo` lists all PRs as a checklist in merge order.

- **`--resume WORKSPACE_ID`** — resume a failed, halted, or `integration_failed` workspace run. Completed children are skipped; failed/blocked/halted children are re-dispatched. For `integration_failed`, resume re-runs the integration test without re-dispatching children.

- **`--dry-run`** — print the DAG and exit without launching children.

- **`workspace_id` in `pipelines.d/`** — each child pipeline's registry entry carries `workspace_id` and `group_type: "workspace"`. The UI reads these fields to group runs under a shared workspace header.

- **Workspace manifest** — workspace-level state is tracked at `{workspace_root}/.worca/workspace-runs/{workspace_id}/workspace-manifest.json`. A pointer file at `~/.worca/workspace-runs/{workspace_id}.json` enables global UI discovery.

- **`worca cleanup --workspace-id WORKSPACE_ID`** — remove all child worktrees, their `pipelines.d/` entries, and the workspace run directory in one command.

- **Workspace events** — new event types emitted via the universal dispatch pipeline: `workspace.launched`, `workspace.halted`, `workspace.completed`, `workspace.failed`, `workspace.tier.started`, `workspace.tier.completed`, `workspace.guide_conflict`. Webhook subscribers receive these automatically.

**New workspace status values:**

| Status | Meaning |
|--------|---------|
| `planning` | Master planner is running |
| `running` | DAG tier execution in progress |
| `integration_testing` | All children completed; integration test running |
| `completed` | All children + integration passed; PRs created |
| `failed` | Tier failure — at least one child failed |
| `integration_failed` | Children completed but integration test failed; no PRs created |
| `halted` | User halted or circuit breaker tripped |
| `blocked` | Per-child status — a dependency failed |

**New status enums:**

`PipelineStatus`, `FleetStatus`, and `WorkspaceStatus` enums added to `src/worca/state/status.py`. All status read sites migrate to enum-based checks in this release.

**New CLI flags on `run_workspace.py`:**

| Flag | Description |
|------|-------------|
| `WORKSPACE_ROOT` | Positional: path to parent directory containing `workspace.json` |
| `--prompt TEXT` | Work-request prompt (mutually exclusive with `--source`) |
| `--source REF` | Source reference (`gh:issue:42`, `bd:bd-abc`) |
| `--guide PATH` | Normative reference guide (repeatable) |
| `--branch TEMPLATE` | Branch name template with `{workspace}`, `{repo}`, `{slug}` placeholders |
| `--skip-integration` | Skip the cross-repo integration test phase |
| `--skip-planning` | Skip the master planner; each repo plans independently |
| `--resume WORKSPACE_ID` | Resume a failed/halted workspace run |
| `--max-parallel N` | Max concurrent children within a tier (default: 5) |
| `--dry-run` | Print the DAG and exit |

**New UI surfaces:**

- **Dashboard workspace grouping** — the worca-ui dashboard groups workspace children under a collapsible workspace header showing an aggregate status badge, DAG progress by tier, and a link to the workspace detail view. Requires **global mode** (`pnpm worca:ui` without `--project`).

- **Workspace detail view** — per-workspace page showing DAG visualization, master plan, per-repo status cards, context artifacts, integration test log, PR table with dependency links, and lifecycle actions (Halt / Pause / Stop / Resume / Cleanup).

- **Workspace launcher** — form to create and launch a workspace run from the UI: workspace root selection, prompt, guide upload, planning/integration toggles.

- **WebSocket events** — `workspace-update`, `workspace-tier-update`, and `guide-conflict` message types added to `protocol.js` allowlist.

**New settings:**

```jsonc
"worca": {
  "workspace": {
    "init_timeout_seconds": 60,      // per-target worca init --upgrade timeout
    "max_parallel": 5,               // max concurrent children within a tier
    "context_cap_bytes": 8192,       // 8 KB cap on inter-tier context artifacts
    "failure_threshold": 0.30        // circuit breaker failure ratio
  }
}
```

All keys under `worca.workspace` are additive. Existing installs pick them up as defaults on the next `worca init --upgrade`.

**No automatic migration required.** All changes are additive — no breaking changes, no settings path migrations, no removed commands. Run `worca init --upgrade` once to pull the new `worca.workspace.*` defaults into your project's `settings.json`.

**Full walkthrough:** [`docs/workspace-runs.md`](./docs/workspace-runs.md).

### 0.29.x → 0.33.0+

W-054: Configurable per-agent tool/skill/subagent dispatch governance.

**Breaking changes:**

1. **`governance.subagent_dispatch` replaced by `governance.dispatch`** — The flat `worca.governance.subagent_dispatch` key is replaced by a nested `worca.governance.dispatch` object with three sections (`tools`, `skills`, `subagents`), each carrying `always_disallowed`, `default_denied`, and `per_agent_allow` tiers. Existing per-agent subagent allow lists are preserved verbatim under `governance.dispatch.subagents.per_agent_allow`.

2. **`Skill` tool unblocked** — The `Skill` tool is no longer in the hardcoded `--disallowedTools` list. A new `skill_use.py` PreToolUse hook gates every skill invocation through the `governance.dispatch.skills` section. Skills matching `always_disallowed` patterns (pipeline-recursion, governance self-modification) are blocked unconditionally. Skills in `default_denied` require explicit opt-in via `per_agent_allow`.

3. **`--disallowedTools` is now settings-driven** — The tool disallow list is resolved from `governance.dispatch.tools.always_disallowed` instead of being hardcoded. The default list (`EnterPlanMode`, `EnterWorktree`, `TodoWrite`) matches the previous behavior.

4. **`pipeline.hook.dispatch_allowed` event gains `via` field** — Telemetry events for dispatch decisions now include `via: "wildcard" | "explicit"`. Downstream consumers that validate event schemas strictly may need to accept the new field.

5. **UI subagent dispatch card replaced** — The single-section subagent dispatch editor in the Governance settings panel is replaced with a three-section editor (Tools, Skills, Subagents). Bookmarks or screenshots of the old layout are stale.

6. **Dispatch telemetry events unified (PR D)** — The two event-name conventions (`pipeline.hook.dispatch_*` for subagents, `pipeline.hook.skill_*` for skills) collapse into a single `pipeline.hook.dispatch_{allowed,blocked}` family. The payload now carries `section` (`"subagents"` or `"skills"`) and `candidate` instead of the section-specific `subagent_type` / `skill` keys.

   ```jsonc
   // OLD (skills)
   { "event_type": "pipeline.hook.skill_allowed",
     "payload": { "agent": "implementer", "skill": "review", "via": "wildcard" } }

   // NEW (both sections)
   { "event_type": "pipeline.hook.dispatch_allowed",
     "payload": { "agent": "implementer", "section": "skills",
                  "candidate": "review", "via": "wildcard" } }
   ```

   Downstream event consumers (webhooks, log scrapers) that filter by `event_type` or read `payload.subagent_type` / `payload.skill` need to read `payload.candidate` and discriminate by `payload.section`. The pre-PR-D `skill_*` event types are no longer emitted by `skill_use.py`. The UI aggregator drops the `payload.subagent_type || payload.skill` fallback and reads `payload.candidate` exclusively; it ignores legacy `skill_*` events that may linger in old event logs.

**Automatic migration via `worca init --upgrade`:**

```
governance.subagent_dispatch -> governance.dispatch.subagents (W-054 — tools and skills sections added with defaults)
```

The migration:
- Moves all per-agent entries from `governance.subagent_dispatch` into `governance.dispatch.subagents.per_agent_allow`
- Seeds `_defaults` from the bundled defaults (`["Explore"]`) if not already present
- Seeds `always_disallowed` and `default_denied` for the subagents section from bundled defaults
- Adds `tools` and `skills` sections with their full default configuration
- Removes the legacy `governance._dispatch_legacy` key if present
- Is idempotent — re-running on already-migrated settings is a no-op

**If you skip `worca init --upgrade`:**

The UI's settings save handler runs the same migration automatically. The next time you save settings through the Governance panel, the old shape is migrated in place.

**New reference:** [`docs/governance.md`](./docs/governance.md) — full reference for the three-tier dispatch model.

### 0.33.x → 0.35.0

W-052: Adaptive effort levels for pipeline agents.

**Behavior change (no breaking API changes):**

1. **New default `auto_mode=adaptive`** — Pipelines that previously ran every agent at Claude Code's model default effort now receive explicit per-agent effort values (`planner: xhigh`, `coordinator: medium`, `guardian: high`) and adaptive loopback escalation. The coordinator classifies each bead's complexity via `worca-effort:<level>` labels, and the implementer consumes those labels as its starting effort.

   **One-line opt-out** to restore pre-W-052 behavior (all agents at model default, no escalation):

   ```jsonc
   // .claude/settings.json
   { "worca": { "effort": { "auto_mode": "disabled" } } }
   ```

2. **Shipped models lack `xhigh`** — The default `worca.models` aliases resolve to **Opus 4.6** and **Sonnet 4.6**, whose effort ladders are `low / medium / high / max` (no `xhigh`). The shipped defaults `planner: xhigh` and `auto_cap: xhigh` are collapsed by model-aware resolution:
   - `planner: xhigh` runs as `high` on Opus 4.6 (base rounds down to the highest supported rung). `status.json` records `level: "high"`, `requested: "xhigh"` so the UI shows the policy-vs-actual divergence.
   - `auto_cap: xhigh` rounds *up* to `max` on 4-rung models, so the cap does not block loopback escalation.

3. **Aggressive escalation on 4-rung ladders** — On the shipped models, a single loopback takes a `high`-base implementer straight to `max` because the ladder has no `xhigh` rung between them:

   ```
   Sonnet 4.6 ladder: low(0) → medium(1) → high(2) → max(3)
                                            ^^^^        ^^^^
                                            base      base + 1 (test_failure)
   ```

   The default `auto_cap: xhigh` permits this (rounds up to `max`). This relaxes the "`max` only via explicit opt-in" guarantee to "explicit opt-in **or** loopback escalation on a model lacking `xhigh`."

   **To prevent auto-escalation to `max`**, pin `auto_cap: high`:

   ```jsonc
   { "worca": { "effort": { "auto_cap": "high" } } }
   ```

   This creates a deliberate dead-zone: escalation clamps at `high` with `capped_from: "max"` recorded in the iteration.

4. **Restoring the full 5-rung ladder** — Point `worca.models.opus` at Opus 4.7 to get all five rungs (`low / medium / high / xhigh / max`). Escalation becomes gentler: `high + test_failure = xhigh` (not `max`), and `auto_cap: xhigh` is an actual ceiling below `max`.

   ```jsonc
   { "worca": { "models": { "opus": "claude-opus-4-7-20250219" } } }
   ```

**New settings (additive):**

```jsonc
"worca": {
  "effort": {
    "auto_mode": "adaptive",   // disabled | reactive | adaptive
    "auto_cap": "xhigh"        // low | medium | high | xhigh | max
  }
}
```

Per-agent effort values (`worca.agents.<agent>.effort`) accept `low | medium | high | xhigh | max`. Omitted = mode-dependent fallback (model default or bead label).

**No automatic migration required.** The new `worca.effort` block is additive — `worca init --upgrade` merges the defaults into your project's `settings.json` non-destructively. Existing per-agent `model` and `max_turns` values are preserved.

**Full reference:** [`docs/effort.md`](./docs/effort.md).

### 0.34.x → 0.35.0

W-054 follow-up: dispatch defaults self-heal on upgrade, and the `worca-*` skills denylist is narrowed.

**Behavior changes (no config edits required):**

1. **Stale Explore-only subagent default is auto-adopted to the new wildcard default.** W-054 preserved each project's existing per-agent subagent allow lists verbatim. Projects that were on the *old shipped default* — every pipeline agent capped to `["Explore"]`, from the W-038 era — were therefore left pinned to Explore-only even though the W-054 default had become `_defaults: ["*"]` (any subagent except `general-purpose`). On upgrade, a config whose `governance.dispatch.subagents.per_agent_allow` exactly matches that legacy Explore-only set is collapsed to `{ "_defaults": ["*"] }`, so pipeline agents (planner, implementer, tester, …) can dispatch any subagent again. **Customized configs are not touched** — the match is exact, and a touched `_defaults` (or any added/changed entry) preserves your settings as-is.

2. **The broad `worca-*` skills denylist glob is narrowed.** `governance.dispatch.skills.always_disallowed` previously hard-denied *every* `worca-*` skill via a glob. It now names only the genuinely-dangerous ones individually (`worca-release`, `worca-rc`, `worca-pr-prep`, `worca-install`, `worca-sync`, `worca-sync-commit`, `worca-sync-pr`, `worca-agent-override`, `worca-analyze`, `worca-plan-new`). Useful dev skills (`worca-dev-precommit`, `worca-coverage`, `worca-ui-add-*`, `worca-event-add`, `worca-webhook-test`, `worca-issue`) become dispatchable via the per-agent `"*"` wildcard. As above, this only rewrites an *untouched* denylist (exact set match); a customized denylist is preserved.

**One-time and version-stamped.** Both normalizations are gated by a new `governance.dispatch_migration_version` integer (current value `1`). They run exactly once per config — on `worca init --upgrade` (Python) or on the next Governance-panel save (UI) — then the stamp prevents them from running again, so deliberately re-pinning agents to Explore-only *after* the upgrade sticks.

**To keep the old (restrictive) behavior**, set the per-agent subagent entries (and/or the skills denylist) explicitly to your preferred values. Because the stamp is written on first upgrade, your explicit choices are never re-widened.

**Automatic migration messages via `worca init --upgrade`:**

```
governance.dispatch.subagents: adopted new default (_defaults: ["*"]) for config pinned to legacy Explore-only set
governance.dispatch.skills.always_disallowed: narrowed legacy "worca-*" glob to the current must-disallow set
```

### 0.35.x → 0.36.0

W-053: Optional Graphify knowledge-graph integration (query-based agent consumption).

**New feature — opt-in, off by default.** When `worca.graphify.enabled` is `true` (project-level), the Preflight stage builds a per-commit code knowledge graph (`graphify update`, content-addressed under `$WORCA_CACHE/ast/<repo-id>/<sha>/graphify/`) and pipeline agents query it on demand. With graphify disabled, pipeline behavior is byte-identical to before.

**How agents consume it:**

- Agents do **not** receive `GRAPH_REPORT.md` injected into their prompts. When a `ready` graph exists, the runner exports `GRAPHIFY_OUT=<snapshot>/graphify` into every agent subprocess, so a bare `graphify query "<question>"` reads the cached `graph.json`. Each stage prompt carries only a one-line availability note; the how-to-use guidance lives in each agent's core `.md` (`## Knowledge graph (advisory)`).
- **Read-only guard:** the `pre_tool_use` hook blocks mutating graphify subcommands (`update`, `install`, `add`, …) and allows reads (`query`, `explain`, `path`, `affected`, `diagnose`). The pipeline owns graph builds.
- `GRAPH_REPORT.md` is cached for humans only (surfaced in the UI Graphify tab with a copy-able query snippet).

**Required tooling (only if you enable graphify):**

- `uv tool install 'graphifyy>=0.8.16,<1'` — the PyPI package is `graphifyy` (double-y); the CLI it installs is `graphify`. Prefer `uv`/`pipx` over plain `pip` so the CLI lands on PATH. Worca pins `>=0.8.16` for the `update` command + `GRAPHIFY_OUT`-honoring reads.

**New settings (additive):**

```jsonc
"worca": {
  "graphify": {
    "enabled": false,        // project-level opt-in
    "mode": "structural"     // structural (fully local) | full (LLM semantic pass)
  },
  "governance": {
    "guards": {
      "block_graphify_mutation": true   // block agent-issued `graphify update/install/...`
    }
  }
}
```

**No automatic migration required.** All changes are additive — `worca init --upgrade` merges the new defaults non-destructively. Graphify stays off unless a project sets `worca.graphify.enabled: true`.

**Full reference:** [`docs/plans/W-053-graphify-integration.md`](./docs/plans/W-053-graphify-integration.md).

### 0.40.x → 0.41.0

`general-purpose` subagent moves from `always_disallowed` to `default_denied` — still off by default, but now allowable per-agent.

**Why:** the `general-purpose` subagent (which spawns an unconstrained, full-tool Claude session) was on `subagents.always_disallowed`. The resolver checks `always_disallowed` *before* `per_agent_allow`, so there was **no way to opt an agent in** — even naming `general-purpose` explicitly in a per-agent allow list (or the UI editor) was silently overruled. Moving it to `default_denied` keeps it blocked under the `"*"` wildcard (default behavior is unchanged — it stays denied) while making the per-agent opt-in path actually work.

**Behavior change (no config edits required):** on upgrade, a config whose `governance.dispatch.subagents.always_disallowed` is *exactly* `["general-purpose"]` (the untouched default) is rewritten to `always_disallowed: []` + `default_denied: ["general-purpose"]` (any pre-existing `default_denied` entries are preserved). A **customized denylist** (extra entries) is left untouched. The UI Governance editor no longer hard-blocks typing `general-purpose` into an allow list.

**One-time and version-stamped.** This is the **v2** dispatch normalization, gated by `governance.dispatch_migration_version` (bumped `1 → 2`). It runs exactly once per config — on `worca init --upgrade` (Python) or the next Governance-panel save (UI) — then the stamp prevents re-runs.

**To re-allow `general-purpose` for an agent** after upgrading, name it in `per_agent_allow` (the mixed form keeps the wildcard for everything else):

```jsonc
"subagents": {
  "default_denied": ["general-purpose"],
  "per_agent_allow": {
    "_defaults": ["*"],
    "implementer": ["*", "general-purpose"]
  }
}
```

**To forbid it everywhere** (no per-agent opt-in possible), add it back to `always_disallowed`.

**Automatic migration message via `worca init --upgrade`:**

```
governance.dispatch.subagents: moved general-purpose from always_disallowed to default_denied (now allowable per-agent)
```

**Full reference:** [`docs/governance.md`](./docs/governance.md) § Subagents.

### 0.42.x → 0.43.0

W-057: Optional code-review-graph (CRG) MCP integration (Tree-sitter AST graph, tool-based agent consumption).

**New feature — opt-in, off by default.** When `worca.code_review_graph.enabled` is `true` (project-level), the Preflight stage builds a per-commit code graph and exposes it to pipeline agents through a per-agent **MCP server** (`code-review-graph serve`). With CRG disabled, pipeline behavior is byte-identical to before. CRG and Graphify (W-053) are independent — either, both, or neither may be enabled.

**How agents consume it:**

- Agents query the graph through **MCP tools** (`mcp__code-review-graph__*` — e.g. `get_architecture_overview`, `get_minimal_context`, `query_graph`), not a Bash CLI and not an injected report. The runner starts a stdio MCP server per agent subprocess via `--mcp-config`; a per-stage `stage_tools` filter narrows which tools each role sees. Each stage prompt carries a one-line availability note; the how-to-use guidance lives in each agent's core `.md` (`## Code graph (use for orientation)`).
- **Read-only guard:** the `pre_tool_use` hook blocks mutating `code-review-graph` CLI verbs (`build`, `update`, `install`, `serve`, …) — agents may only read via MCP tools. The pipeline owns all graph builds. Gated by `worca.governance.guards.block_crg_mutation` (default `true`).
- The graph is content-addressed under `$WORCA_CACHE/ast/<repo-id>/<sha>/` (same cache model as Graphify: clean commit → `<sha>/`, dirty tree → throwaway `<sha>.dirty/`). Nothing is written into the repo tree.

**Required tooling (only if you enable CRG):**

- `pip install 'code-review-graph>=2,<3' 'fastmcp>=3.2.4'` — the `code-review-graph` CLI plus its `fastmcp` runtime dependency (a separate hard floor). The UI Code Review Graph settings tab surfaces this exact command and a re-check button.

**New settings (additive):**

```jsonc
"worca": {
  "code_review_graph": {
    "enabled": false,            // project-level opt-in
    "embeddings": false,         // semantic embeddings pass (extra cost)
    "freshness": "clean_only",   // only build on a clean tree; dirty -> throwaway
    "min_repo_files": 100,       // skip tiny repos
    "version_range": ">=2,<3",
    "fastmcp_min": "3.2.4",
    "stage_tools": null          // per-stage MCP tool filter (null = role defaults)
  },
  "governance": {
    "guards": {
      "block_crg_mutation": true // block agent-issued code-review-graph build/serve/...
    }
  }
}
```

**UI:** the run-detail Preflight stage shows a **Code Review Graph** status pill (cached / rebuilt / built (uncommitted) / skipped / unavailable / off), and each agent iteration shows a Code Review Graph invocation badge with a per-tool breakdown tooltip on hover.

**No automatic migration required.** All changes are additive — `worca init --upgrade` merges the new defaults non-destructively. CRG stays off unless a project sets `worca.code_review_graph.enabled: true`.

**Full reference:** [`docs/plans/W-057-code-review-graph-integration.md`](./docs/plans/W-057-code-review-graph-integration.md).

### 0.43.x → 0.44.0

**Bundle export/import scoped to referenced model aliases + per-alias collision UX.**

- `worca templates export --include-models / --include-pricing` now drops `worca.models` and `worca.pricing.models` entries that the exported templates don't actually reference (via `config.agents.*.model`). Previously the entire blocks were copied verbatim, so a one-template export shipped every alias in your `settings.json`.
- `worca templates import` applies the same filter against the bundled templates that landed, and additionally detects per-alias collisions against the target's current `settings.worca.models` and `pricing.models`. Different-value collisions surface a warning and prompt `[r]eplace / [s]kip / [a]bort`; `--non-interactive` defaults to skip (preserve target's values). Same-value entries are no-ops.
- Top-level pricing keys (`server_tools`, `currency`, `last_updated`) still pass through because they're project-wide context, not alias-specific.
- The `id` field on a model entry is **not** treated as a recursive alias reference — it's the literal string passed to `claude --model`. So `models["glm-ds"] = {"id": "opus", ...}` does not pull `models["opus"]` into the bundle.
- `worca-template` skill interview is split into two `AskUserQuestion` batches and the previous 5-option "stages to toggle" question is split into core (Test / Code review / PR creation) + advanced governance (Plan review / Learn) — single-batch form hit the 4-question / 4-option caps and failed with `Invalid tool parameters`.

No automatic migration required. Re-exporting old bundles will produce smaller, scope-correct bundles.

---

W-059: Plan review `review_and_edit` mode — optional in-place plan editing by the reviewer.

**New feature — opt-in, off by default.** When `worca.stages.plan_review.mode` is set to `"review_and_edit"`, the Plan Reviewer rewrites the plan in place to resolve critical/major issues and self-approves, skipping the loopback to the Planner. Default behavior (`mode: "review"`) is unchanged. Plan review itself remains disabled by default (`worca.stages.plan_review.enabled: false`).

**New settings (additive):**

```jsonc
"worca": {
  "stages": {
    "plan_review": {
      "mode": "review"           // "review" (default) | "review_and_edit"
    }
  },
  "governance": {
    "plan_review_enforce": "auto"  // "auto" | "review" | "review_and_edit"
  }
}
```

- `mode` selects the review behavior per pipeline/template.
- `plan_review_enforce` is a project-level governance override — when not `auto`, it forces the specified mode across all pipelines regardless of template.

**New event:** `pipeline.plan_review.edited` (`PLAN_EDITED`) — emitted when the reviewer edits the plan in `review_and_edit` mode. Payload includes issue severity counts and the path to the preserved original plan file.

**New template:** `feature-fast` — mirrors `feature` but enables `review_and_edit` mode for faster plan review cycles.

**No automatic migration required.** All changes are additive. Run `worca init --upgrade` once to pull the new defaults into your project's `settings.json`.

### 0.44.x → 0.45.0

- **Cost override for alt-endpoint aliases.** Model aliases that route Claude CLI through a non-Anthropic endpoint (i.e., the alias's `env` block in `worca.models` sets `ANTHROPIC_BASE_URL`) now have their run cost computed from your `worca.pricing.models.<alias>` entry instead of from Claude CLI's built-in Anthropic pricing — Claude CLI's number is wrong against a non-Anthropic endpoint. If no matching pricing entry exists, cost is recorded as $0 with a one-time stderr warning prompting you to add one.
- **Vanilla installs are unchanged.** The built-in `opus` / `sonnet` / `haiku` shorthands (and any user rename that doesn't set `ANTHROPIC_BASE_URL`) continue to use Claude CLI's authoritative `total_cost_usd`. The Pricing tab numbers for these rows remain a fallback for interrupted runs and a reference for forecasting — they do not override live cost.
- **`status.json` schema (additive).** Runs that use an alt-endpoint alias now carry `token_usage.model_alias` and `token_usage.cost_source: "alias"`. Absence of these fields means Claude CLI was authoritative — backward-compatible with existing consumers.
- **`worca templates import` works across filesystems again.** Imports previously failed with `OSError: Cross-device link` whenever the system tempdir was on a different filesystem from the repo (macOS `/private/var/folders/...` vs `/Volumes/X`, Linux tmpfs `/tmp` vs ext4 on `/home`, Windows `C:\…\Temp` vs a secondary `D:\` drive) because `settings.json` was staged in the system tempdir and atomically renamed via `os.replace`, which fails with EXDEV across filesystems. The staging file now lives next to the target on all three platforms, so the `TMPDIR=<inside-repo>` workaround is no longer needed.

### 0.45.x → 0.46.0

- **Template tier resolution swapped to `project > user > built-in`** (was `user > project > built-in`). The natural mental model — "this project pins the template, my personal copy is a fallback" — now matches the code. **Behavior change only fires on ID collisions between a project and a user template of the same name**: previously the user template silently won; now the project template wins. If you relied on a user-tier template named the same as a `.claude/templates/` entry to shadow it, rename the project entry (or delete it) to restore the prior outcome. Built-in resolution is unchanged — either tier still shadows built-ins of the same id. `worca templates list --json` reflects the new order so downstream tooling (`/worca-analyze`, `/worca-template`) sees the same winner the runtime will use.
- **Template-driven pipelines (Phase 1).** When a template is in play at run launch — either picked explicitly (`--template` / `POST /runs` body) or pinned via the new `worca.default_template` field — these keys are stripped from the project-Settings merge base before the template's `config` applies: `worca.agents`, `worca.stages`, `worca.loops`, `worca.circuit_breaker`, `worca.effort`, `worca.governance.dispatch`. The selected template owns them outright. Cross-template keys — `worca.models`, `worca.webhooks`, `worca.pricing`, `worca.governance.guards`, `worca.graphify`, `worca.code_review_graph`, `worca.default_template` itself, preflight check definitions — continue to apply as before. Rationale: a shared template now behaves identically across machines until explicitly edited; project Settings can't silently drift the template at one developer's machine.
- **Auto-migration on `worca init --upgrade`.** If your project's `.claude/settings.json` carries customized values for any of the template-owned keys above AND `worca.default_template` is not set, the upgrade snapshots those values into an auto-generated project template `.claude/templates/_legacy-settings/template.json` (`auto_generated: true`, `tags: ["auto-migrated"]`), commits, and sets `worca.default_template = "_legacy-settings"`. **Result: zero behavior change on existing projects** — your customized values keep applying via the new default-template path. Idempotent (skipped if `default_template` is already set) and collision-safe (renames to `_legacy-settings-<unix-ts>` if a user-authored template of that name already exists). To revert at any time, delete the auto-template and clear `worca.default_template` from settings.json — Settings then resume their old role for any run that doesn't pick a template.
- **New Settings → Pipeline / Agents / Effort / Governance.dispatch banner.** Each template-driven tab in the dashboard now carries a neutral banner: "Template-driven settings. When a pipeline template is in play at run launch — either picked explicitly or pinned via `worca.default_template` — these values are not applied. The selected template owns them." Links to the [precedence reference](https://docs.worca.dev/configuration/precedence/). Full Pipelines editor is tracked under [W-062](https://github.com/SinishaDjukic/worca-cc/issues/265).
- **`worca.milestones` is now template-owned.** Approval gates (`plan_approval`, `pr_approval`, `deploy_approval`) join the strip set, so a teammate's Settings can't silently flip your gates when picking the same template. Every built-in explicitly declares its gate posture: `feature` / `feature-fast` / `refactor` keep `plan_approval: true`; the autonomous flows (`bugfix` / `feature-minor` / `quick-fix` / `investigate` / `test-only`) declare all three gates `false`.
- **Built-in templates enriched for completeness.** Every built-in (`bugfix` / `feature` / `feature-fast` / `feature-minor` / `quick-fix` / `investigate` / `refactor` / `test-only`) now declares every template-owned block (effort, agents, loops, circuit_breaker, stages-minus-preflight, milestones) explicitly — sparse built-ins previously fell through to orchestrator code defaults under the strip semantics. `governance.dispatch` is the one exception (built-ins still rely on the runtime `_DISPATCH_DEFAULTS`); a regression test in `tests/test_builtin_templates.py` catches any future built-in that ships sparse.
- **`stages.preflight` cross-template carve-out.** Even though `stages` is template-owned, `stages.preflight` is preserved across the strip — templates can still deep-merge over it (e.g. a template could explicitly opt out of preflight), but if a template doesn't touch preflight, your project's preflight check definitions keep flowing through. Codified in `CROSS_TEMPLATE_CARVEOUTS` in `src/worca/orchestrator/templates.py`.
- **Pipeline Template dropdown relabel** (worca-ui). The launcher's "Project Default (settings.json)" option now reflects what will actually run: when `worca.default_template` is set, it reads `★ Default template: <name>`; when the pinned id can't be resolved, `★ Default template: <id> (missing)`; when unset, the honest `No template (raw settings.json)`.

### 0.46.x → 0.47.0

- **Pipeline editor UI** (W-062). A new top-level **Pipelines** section in worca-ui provides full CRUD over project and user templates — create, edit, duplicate, delete, validate, set-as-default — backed by `worca-ui/server/templates-routes.js`. The Settings → Pipeline "Template-driven" sub-panel now deep-links into this editor.
- **`GET /api/projects/:id/templates` response shape changed.** The list endpoint now deduplicates templates by id (project > user > built-in, matching `TemplateResolver.list()`) and returns two new fields per entry: `effectiveTier` (the tier that actually applies) and `shadows` (array of lower-priority tiers hidden by the winner, e.g. `["user", "builtin"]`). Previously the endpoint returned one entry per tier per id with no dedup, so the same template could appear up to three times. **External tooling that consumes this endpoint** should update to use `effectiveTier` instead of `tier` and handle the deduplicated shape. The old per-tier `tier` field is removed.

### 0.47.0 → 0.48.0

- **Context-window consumption surfaced per iteration** (#272). The runtime now tracks the last assistant turn's `message.usage` in `process_stream()` and computes `context_final_pct` (input + cache_read + cache_creation tokens, divided by `modelUsage[model].contextWindow`). The Iteration view in worca-ui renders `Context: NN%` next to the agent meta strip when known. Alt-endpoint runs suppress the metric (no reliable context-window denominator). `cost_stage_total_payload` schema gains an optional `context_final_pct` field; `schema_version` bumped accordingly. Subscribers that consume the payload should be additive — the field is optional and absent for alt-endpoint stages.
- **Template editor round-trip fixes** (#273). Four silent value-mishandling bugs in the W-062 Pipeline editor are fixed:
  - `config.effort` (`auto_mode` / `auto_cap`) is now seeded from the template instead of falling back to `adaptive / xhigh`. Previously, opening a template with `auto_mode: disabled` showed `adaptive` in the Agents tab and any casual edit overwrote disk back to the default.
  - `config.governance.guards` (cross-template hook gates) is no longer captured into the template on save. Templates saved with the previous editor may have absorbed the project's `guards` snapshot — re-opening and re-saving on this release returns them to "project-owned" cleanly.
  - `config.governance.dispatch` no longer silently widens to include the project's per-agent allowlists. Each dispatch section (tools / skills / subagents) now carries a dirty flag — untouched sections write the template-original; only edited sections write the merged view.
  - Per-agent fields beyond `model / max_turns / effort` survive round-trip via an `_original` overlay; no current built-in uses extra keys, but future additions won't silently drop.
- **Editor UI polish.** The Governance tab's "Plan review enforcement" section drops its redundant `ENFORCE MODE` field label (an `aria-label` on the `<sl-select>` replaces it for screen readers). The Iteration view's Effort row absorbs the Bead chip inline; the chip is suppressed when the bead label matches the effort level, when `auto_mode: disabled` made the label irrelevant, or when it was applied as-is. The common case (`fast` template with `auto_mode: disabled`) now renders one compact row instead of two near-identical ones.
- No config / settings.json migration required — `worca init --upgrade` is sufficient.

### 0.48.x → 0.49.0

W-065: Deferrable PR creation with manual promote-from-UI.

- **New `worca.stages.pr.defer` toggle (default `false`).** When `true`, the guardian stage composes the PR title/body/base and stashes them in `status.json` (`pr_deferred: true` plus `stages.pr.{pr_title,pr_body,base_branch,source_branch}`) instead of opening a PR. Promote it later with `worca pr create <run-id>` or the **Create PR** button on the run-detail PR section. Default-off means existing projects are unaffected. This is a **template-owned** key (it lives under `worca.stages`), so a template in play at run launch owns it — set it in the template's `config`, not project Settings, when a default template is pinned.
- **The config toggle and the workspace `WORCA_DEFER_PR=1` env var compose monotonically** — either can defer, neither can un-defer. Workspace child runs continue to defer to the parent DAG executor exactly as before.
- **Caution — `pr-deferred.json` schema is stricter (upgrade-ordering hazard for custom guardians).** On `outcome: success` the deferred PR schema now *requires* `pr_title`, `pr_body`, and `base_branch` (previously only `deferred` + `commit_sha`). This schema gates **every workspace child run** (they always set `WORCA_DEFER_PR=1`). The shipped `guardian.md` was restructured to emit those three fields, so a consistent install is fine — but a project with a **custom/pinned `.claude/agents/guardian.md` override** (or a stale `.claude/worca/` runtime copy) that predates W-065 will keep emitting the old deferred shape, which the new schema rejects → the guardian stage fails on workspace/deferred runs that worked before. **Fix: run `worca init --upgrade`** to refresh the runtime schema *and* re-derive the guardian prompt; if you maintain a guardian override, add `pr_title`/`pr_body`/`base_branch` to its deferred-branch structured output. Non-deferred runs use the unchanged `pr.json` schema and are unaffected.
- **`status.json` schema (additive).** Deferred runs gain a top-level `pr_deferred: true`, the stashed `stages.pr.*` fields above, and a `pr_creation` block (`state: in_progress|done|failed`, timestamps, `pr_url`/`error`) written by `worca pr create`. Absence of these fields means a normal (non-deferred) run — backward-compatible with existing consumers.
- **New `pipeline.git.pr_deferred` event** (Tier 1, chat-rendered, `warning` severity) fires when a deferred run reaches done. Additive — subscribers that don't recognize it simply ignore it; the pipeline outbound constant count moves 56 → 57.
- No automatic settings.json migration required beyond `worca init --upgrade` (which refreshes the schema + guardian prompt as noted above).

### 0.49.x → 0.50.0

- **`quick-fix` template now mandates a single bead (`max_beads: 1`).** Previously the coordinator could produce multiple beads for a quick-fix run; now it is instructed to deliver the entire fix as one atomic bead. All other built-in templates (feature, bugfix, refactor) remain unchanged at `max_beads: 0` (auto). If you have a **custom `quick-fix` template override** that relies on multi-bead decomposition, add `max_beads: 0` to its `config.agents.coordinator` block to restore the old behavior.
- **New `worca.agents.coordinator.max_beads` config key (additive, default `0`).** No existing runs or templates are affected — `0` means auto, which is today's behavior. The key is template-owned and settable per-run via `--max-beads`. No `worca init --upgrade` required.

### 0.50.0 → 0.51.0

- **No breaking changes.** Agent prompt refinements (execution-stage scope bounding, reviewer notes/observations schema alignment, role-bounding guardrails on investigate/guardian), env hygiene (subprocess env now strips stale `WORCA_*` / `CLAUDECODE` for nested invocations — #307), reviewer diff scoping fix (diff now scoped to pipeline-start git_head — #305), and worca-ui Max Beads dropdown passthrough sentinel (#304). No `worca init --upgrade` required; settings and runtime layout unchanged.

### 0.51.0 → 0.52.0

PR #308: template bundle layout v3, two-phase import with collision dialog.

- **New bundle layout v3 (zip + `models.json` member).** Standalone exports now bundle `worca.models` aliases and pricing in a new top-level `models.json` zip member alongside the template + overlays. Fixes the silent drop where overlay-bearing templates produced bundles that referenced custom model aliases the bundle didn't actually carry. Output bundle version is `v3` when models are present, `v2` otherwise. **Importer still accepts v1 (JSON-only), v2, and v3 bundles** — no flag day, existing bundles keep working. (`SUPPORTED_BUNDLE_MAJOR = 3` in `src/worca/orchestrator/bundle.py`.)
- **Two-phase import — preview then commit (additive).** A new `GET /templates/import/preview` endpoint and matching CLI preview pass surface every collision (template ids and model aliases) before any write. Commit honors per-row resolutions from the preview. Direct one-shot imports still work for back-compat.
- **New collision-resolution CLI flags (defaults preserve old strict behavior).** Two dimensions resolved independently:
  - `--on-template-conflict={abort,skip,replace}` (default `abort`)
  - `--on-model-conflict={abort,skip,overwrite,rename}` (default `abort`)
  Defaulting to `abort` means old scripts that previously errored on a collision still error in the same place — no silent data loss. To restore the old "fail loud" behavior explicitly, omit the flags. Rename uses a zero-padded `-NN` suffix and transactionally rewrites every `config.agents.*.model` reference across imported templates.
- **Model aliases always land in user-global `~/.worca/settings.json`, regardless of `--scope`.** This is a behavior change: previously a `--scope project` import could leave model aliases in the committed `.claude/settings.json`. Now bundle model aliases always write to `~/.worca/settings.json` so committed settings stay free of per-developer env scaffolds and secret placeholders. Template payloads themselves still honor `--scope`. The CLI's prior "no user-level settings.json" framing for `--scope user` was incorrect — that file has always existed via `load_global_settings()`; the writer just didn't target it.
- **New `/api/projects/:projectId/effective-settings` endpoint (worca-ui).** Layers `userGlobal → userLocal → project → projectLocal` the same way Python's `resolve_model` does, so the per-agent Model dropdown surfaces user-global aliases across every template without a project-level redefinition. Pure addition — existing endpoints unchanged.
- **Editor cache invalidation on import.** Imported template ids are evicted from the worca-ui editor cache so the next view picks up the imported config without a manual refresh. No user action required.
- **No settings.json migration required.** `worca init --upgrade` refreshes the runtime copy but does not rewrite settings for this release. Settings and runtime layout are unchanged.

### 0.52.0 → 0.53.0

Top-level Models page; bundle imports scope-honest; cross-tier model resolution changes from deep-merge to whole-entry replace.

- **New top-level "Models" page in worca-ui.** Mirrors Pipeline Templates: three stacked collapsible sections (Built-in / User / Project) with the same card pattern. Each model alias is a card; click to open the editor (alias + id + env table + pricing accordion + applied-by). Project-scope-only — hidden in global mode, same rule as Pipeline Templates.
- **Settings → Models tab removed.** Per-alias management moved entirely to the new Models page. No redirect — direct deep links to the old tab navigate to the Settings root instead.
- **Settings → Pricing renamed to "Costs & Budgets".** Per-model pricing rows are gone (each model now carries its own Pricing accordion in the editor). The tab keeps Web Search, Web Fetch, currency, and budget. A notice at the top points at the new Models page.
- **Bundle import is now scope-honest for models and pricing.** Previously `worca templates import --scope project` *always* wrote bundle `worca.models` and `worca.pricing.models` to `~/.worca/settings.json` regardless of `--scope`. Now templates, models, and pricing all land in the same chosen tier (the project's `.claude/settings.json` for `--scope project`, `~/.worca/settings.json` for `--scope user`). The UI bundle-import dialog's tier picker now applies to the whole bundle. Existing scripts that relied on the old "always user-global" behavior for models need to switch to `--scope user` explicitly if that's still what they want.
- **Cross-tier resolution for `worca.models.*` and `worca.pricing.models.*` is now whole-entry replace.** Previously the layered settings stack (user-global → project → project-local) deep-merged each alias entry field-by-field, so a project entry `{id: "X"}` would silently inherit env from a user-global entry `{id: "Y", env: {...}}`. Now an alias resolves from exactly one tier — Project shadows User shadows Built-in, in entirety. Within a single tier, the `settings.json` / `settings.local.json` id/env split still composes (that's a storage-format detail, not a tier). Any setup that relied on cross-tier composition needs to copy the full entry into the tier that should own it. Other `worca.*` paths continue to deep-merge as before.
- **Imported models stamp `_imported_from` attribution metadata.** `worca templates import` writes `_imported_from: "<bundle-name>"` on each imported entry's `worca.models.<alias>` block. The Models page surfaces this as an "Imported · X" badge on the card and a banner in the editor. The badge is dropped on the first UI save (ownership transfer).
- **No `worca init --upgrade` migration required.** Settings file shape is unchanged; the new resolution semantics are read-side only and the new UI page is purely additive in worca-ui. Old settings continue to work; the only observable behavior change is the cross-tier replace (above).

### Optional improvements (0.53.0 → 0.54.0)

These are not breaking changes — existing configurations continue to work unchanged. They are opt-in improvements you can apply at any time.

- **Set `worca.claude_md_mode` to `"project"` for hermetic runs.** If you run worca across multiple machines, in CI, or in workspace/fleet scenarios where ancestor `CLAUDE.md` files from a parent directory could silently change agent behaviour, add this to your project settings:

  ```json
  { "worca": { "claude_md_mode": "project" } }
  ```

  This restricts each agent subprocess to only the project-root `CLAUDE.md`, producing consistent behaviour regardless of the contributor's directory structure. Use `"project+local"` to also keep `CLAUDE.md.local` for per-developer overrides. This setting flows through correctly on templated runs — built-in templates no longer pin `claude_md_mode: "all"`, so the project value applies unless a template explicitly overrides it. See [docs/claude-md-mode.md](./docs/claude-md-mode.md) for the full reference including constraints and template config.

### 0.54.x → 0.55.0

Template advisor lands as a new feature surface. Workspace plan-skip semantics tighten in `master`/existing-plan modes. Alt-model streams tolerate `null` token/duration fields.

- **Template advisor — Suggest button on the new pipeline page.** A Sparkles "Suggest" button now sits next to the Pipeline Template dropdown in the launcher. It analyses the work source (prompt, spec file, GitHub issue, or GitHub PR with review comments) via an LLM agent and recommends the best-fit template from your catalog (built-in + project + user) with a confidence label and rationale. Cross-repo URL guard: if a GitHub URL's owner/repo doesn't match the current project's, the advisor short-circuits with an explanatory dialog before paying for an agent call. New CLI: `worca templates advise` (prompt streamed via stdin). New backend assets: `src/worca/agents/core/template-advisor.md`, `template-advise.block.md`, `src/worca/template_advisor.py`, `src/worca/schemas/template_advisor.json`. Companion runtime fix: `normalize_github_pr` now honours the owner/repo encoded in a parsed URL (`gh pr view --repo …`), which also fixes any pipeline launch that pastes a full PR URL across repositories. No settings migration required; the advisor is purely additive. See [docs/running-pipelines/launching-a-run.md § Suggest button](./docs-site/src/content/docs/running-pipelines/launching-a-run.md) for the walkthrough.
- **Workspace plan-skip semantics tightened in `master`/existing-plan modes (#313).** Previously, a workspace project without a plan in these modes proceeded with an empty plan; the new behavior **skips** the project explicitly, emits a `pipeline.workspace.project_skipped` event with the reason, and lets the DAG continue with the remaining projects. This is a small behavior change for workspace runs that relied on the old empty-plan fallback — if you were depending on the implicit empty plan, switch to `--planning-mode auto` (default) or supply a plan via `--project-plan NAME=PATH`. Pure planning runs (`--planning-mode workspace`) are unaffected.
- **Alt-model streams tolerate `null` token/duration fields.** `dict.get(key, 0)` only substitutes the default for *absent* keys — a key present with `value: null` (which alt-endpoints like Gemini via OpenRouter sometimes emit) passes through as `None` and crashed `+=` on the integer accumulator. The accumulators in `utils/claude_cli.py` now use `or 0` so `null` is treated as zero. Two crash sites fixed: the context-window % calculation and `duration_ms` / `num_turns` accumulation. No action required; this is a runtime robustness fix.
- **No `worca init --upgrade` migration required.** Settings file shape is unchanged.

### 0.47.x → 0.48.0 (@worca/ui)

UI-only release tracking the worca-cc 0.55.0 surface changes plus a docs-coverage pass.

- **Help badges wired for the new Models page and CLAUDE.md mode.** The `?` help-mode toggle now reveals badges on the top-level Models page, the Model Editor, the new-pipeline page's CLAUDE.md Mode dropdown, and the template editor's CLAUDE.md Load Mode section. Each badge opens the matching `docs.worca.dev` page in a new tab. No setting required — discoverable via the right-edge "Docs" tab or the `?` keyboard shortcut.
- **Template advisor — Suggest button.** UI counterpart to the worca-cc advisor (above). `sl-dialog` paints an "Analyzing…" spinner synchronously and an AbortController + request token guards against stale responses if you dismiss mid-call.
- **Advisory min-effort indicators per agent.** The Pipelines editor renders a yellow chip on the Effort field (Agents tab) and a matching chip under each stage's agent picker (Stages tab) when the configured effort falls below a hardcoded recommended floor (planner / plan_reviewer / reviewer / workspace_planner = `high`; coordinator / guardian = `medium`; implementer / tester / learner = `low`). Purely advisory: not persisted to template config, never read by the runtime.
- **`claude_md_mode` editable in the template editor.** New section in the Pipeline tab between Approval Gates and Loops, with the same Template-Default / Explicit hint pattern as Max Beads. Round-trips cleanly with project settings.
- **Built-in templates can be set as project default.** The `★ Default` toggle now appears on built-in cards in addition to project-tier cards. Built-ins ship with the package, so pinning one is fully portable. Only user-tier templates remain excluded.
- **Models editor polish.** New cost-source badge taxonomy (`explicit` / `Claude CLI` / no badge); `—` placeholder for unset pricing fields (so `0` stays meaningful for truly-free rates); a **Clear pricing** button that wipes all four fields; widened env-var key/value columns; a **Not configured** danger badge + red-outlined value cell when any env value is still `<YOUR-SECRET-HERE>`.
- **Bundle import id/env split.** Imported `worca.models.<alias>` entries now land split across `settings.json` (id) and `settings.local.json` (env) so secret-bearing env always stays out of the committed file. Models cache refreshes automatically after import.

### 0.55.x → 0.56.0 — tier-pinned model refs

Tier-pinned model refs (`user:alias`, `project:alias`, `builtin:alias`) are a new syntax for `worca.agents.<name>.model` and template model fields.

- **New syntax.** A model ref may now be prefixed with a tier: `user:sonnet`, `project:opus`, `builtin:haiku`. This hard-pins resolution to that settings tier and bypasses the normal merged-dict lookup. Bare refs (no prefix) continue to work unchanged and remain the default save form.

- **Bare-default save rule (D1).** No existing `settings.json` files are affected. The UI and `worca models add` write bare aliases by default unless `--tier` is passed. Tier-pinned refs are opt-in.

- **Auto-pin on bundle import (D3).** `worca templates import --scope <tier>` now rewrites bare model refs in the imported bundle to `{scope}:alias`. This prevents the imported template from accidentally resolving against a same-named alias in the destination project. If you re-import a previously exported bundle, the resulting entries will carry tier pins that were not there before — this is intentional. To revert, replace the pinned ref with the bare alias in `settings.json`.

- **`work_request.py` haiku pin — behaviour change (D5).** The internal title-generation call now uses `builtin:haiku` unconditionally. Previously it resolved `haiku` through the merged models dict, so a project that shadowed the `haiku` alias (e.g. for cost routing or an alt-endpoint) would see title generation use that custom model. That shadow is now bypassed. If you relied on this, configure the `extract_work_request` call explicitly or leave the `haiku` alias as-is for title generation.

- **New `worca models add --tier` flag (D6).** `worca models add <alias> <model-id> [--tier user|project] [--env KEY=VAL]` places the alias directly in the chosen tier's settings file. `--tier builtin` is rejected. If `--tier` is omitted, the command infers `project` (git root found) or `user` (fallback). The `id` field goes to `settings.json`; `--env` pairs go to `settings.local.json`.

No `worca init --upgrade` migration required — settings file shape is unchanged.

### 0.55.x → 0.56.0 — pluggable pipeline & declared context contract (W-070/071/072)

The pipeline is now declarative: stage order and outcome-driven loop transitions
live in `worca.flow`, every builtin stage runs through a generic executor, and
custom stages are supported (drop an agent `.md` + schema + flow entry). Omitting
`worca.flow` keeps the byte-identical builtin 9-stage flow, so existing projects
need no change. Stage outputs are now a declared contract: flow stages carry an `outputs` map
(name → JSON pointer into the validated schema result), the executor
publishes each value as `stages.<stage>.<output>` in the prompt context, and
templates consume them via namespaced placeholders (`{{stages.plan.approach}}`).
Full reference: [`docs/flow.md` § Declared context contract](./docs/flow.md#declared-context-contract-w-072).

- **Legacy flat keys keep working.** Publication dual-writes both the
  namespaced and the legacy flat form (`plan_approach`, `test_failures`, …),
  and lookups fall through the flat ↔ namespaced alias table in both
  directions. Project agent overlays referencing flat keys are unaffected.
  Flat *publication* will be removed after a two-release deprecation window;
  alias *read* support is permanent. Grep your `.claude/agents/` for the flat
  keys listed in docs/flow.md and migrate at your convenience.

- **`prompt_context.json` schema version 2.** The per-run context file gains
  a `schema_version: 2` marker and a nested `stages` namespace. Version-1
  files (from runs started under an older worca) load unchanged and resume
  cleanly — namespaced reads resolve through the alias table.

- **Launch-time consumption lint — behaviour change.** Every enabled stage's
  resolved templates (project overlays included) are linted at launch: a
  `{{stages.<s>.<o>}}` reference whose producer doesn't exist upstream (or
  via a declared loop) or doesn't declare the output now **fails the launch**
  with a `FlowError`, for custom and default flows alike. Previously a typo'd
  placeholder silently rendered as an empty string. Unknown *flat* keys only
  produce advisory warnings.

- **Custom-flow fingerprints change shape.** `outputs` is part of the flow
  fingerprint, so a custom-flow run paused under a pre-W-072 build cannot
  resume across the upgrade boundary (the fingerprint check fails loudly).
  Finish or restart such runs.

Run `worca init --upgrade` to refresh the runtime copy (templates +
`flow.json` schema).

### 0.48.x → 0.49.0 (@worca/ui) — project setup wizard (W-073)

UI-only release. Adding a project now opens a guided **Project Setup** wizard, and the Settings → Projects tab is reworked. Purely additive — no settings migration.

- **Project Setup wizard.** After adding a single project, a 5-step wizard opens (Preflight → PR Base Branch → Optional Tools → Default Template → Done) and is re-triggerable from **Settings → Projects** (gear icon). When the project lacks the worca runtime it inserts an **Install Worca** step that runs `worca init --upgrade` inline — replacing the old standalone install prompt. The template step reuses the launcher's grouped tier dropdown; the final step links straight to Integrations when no chat notifier is configured.
- **Projects tab reworked + terminology.** The Projects list is now a table (matching Workspaces) with banded rows and a version-only badge; projects whose path is missing on disk show a "not found" badge and have Update/Setup disabled. The Add Project dialog's second mode is renamed **Workspace → Multiple projects** ("Parent Path"), since it batch-registers projects rather than creating a workspace. The sidebar group **Project Configuration → Configuration**.

No `worca init --upgrade` migration required — the wizard writes the same settings keys you could already edit by hand.

### 0.57.x → 0.58.0 — runtime provenance (W-074)

`worca init` and `worca init --upgrade` now write a `.claude/worca/provenance.json` manifest that records the worca version and how the runtime copy was sourced (git checkout or pip install). Each pipeline run stamps this block into `status.json` and the `pipeline.run.started` event, and displays it as a **Runtime:** row in the Preflight UI panel.

### 0.57.x → 0.58.0 — user-tier `settings.local.json` now read by model resolution (bug fix)

The user-global tier now deep-merges `~/.worca/settings.local.json` everywhere, matching how the project tier and the public `load_global_settings` API already behaved. Previously `load_settings_with_global_fallback` read `~/.worca/settings.json` with a raw `json.load` that skipped the `.local` sibling, so user-tier model `env` blocks (alt-endpoint base URLs, auth tokens) stored there were silently dropped from both the merged config and the `user:` tier-pin views.

**Symptom this fixes.** `worca templates import --scope user` of an alt-endpoint alias writes the `env` (secrets) to `~/.worca/settings.local.json` and auto-pins the template's refs to `user:<alias>` — but the resolver never saw that env, so every agent ran against the default Anthropic endpoint instead of the routed one (the `[init] model=` line showed the builtin model, not the alias target).

**Action required only if** you have a user-tier model alias whose `env` (routing/secrets) lives outside `~/.worca/settings.local.json` — e.g. the `id` in `~/.worca/settings.json` but the `env` only in a *project's* `settings.local.json`. For `user:<alias>` refs to route correctly, the `env` block must live in `~/.worca/settings.local.json`. Move it there (or re-run `worca templates import --scope user`, which now writes it to the right place). No `worca init --upgrade` migration is needed — this is a resolver fix; the on-disk file shape is unchanged.

**No breaking changes.** Existing runs and integrations are unaffected. Projects that have not yet run `worca init --upgrade` will show a degraded provenance block (version only, `runtime_source: null`) until the manifest is written.

Run `worca init --upgrade` in each project to populate the manifest and enable full provenance display.

## Getting help

- Issues: https://github.com/SinishaDjukic/worca-cc/issues
- The `/worca-install` and `/worca-sync` skills handle most install/upgrade flows

---

*Follow-up: add a pointer to this file from the project README: `> **Upgrading?** See [MIGRATION.md](./MIGRATION.md).`*
