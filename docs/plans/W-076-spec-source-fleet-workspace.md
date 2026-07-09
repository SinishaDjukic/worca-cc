# W-076: Specification source type for fleet & workspace runs

**Status:** Draft
**Priority:** P1
**Area:** cc
**Date:** 2026-07-02
**Depends on:** None

## Problem

A workspace run launched from the UI with **Source Type = "Specification"** (a file path such
as `docs/plans/001-openapi-v3-generation.md`) completes instantly doing nothing. The generated
`workspace-plan.json` reports "no user request to work with", every child finishes with
`run_id=null`, and the fetched manifest shows empty `work_request.title` / `work_request.description`.

The bug spans three layers, none of which fleet/workspace implement — but the single-project
run path does:

1. **UI** — the source-type selector offers Prompt / Specification / GitHub Issue / GitHub PR
   (`worca-ui/app/views/fleet-launcher.js:415`), but at submit only a bare `source` value is
   sent and the `sourceType` discriminator is **dropped** (`fleet-launcher.js:192` fleet,
   `fleet-launcher.js:261` workspace). The server cannot tell a spec file path from a
   `gh:issue:N` ref.
2. **Server** — `buildWorkspaceArgs` (`worca-ui/server/app.js:80-84`) and `dispatchFleet`
   (`worca-ui/server/app.js:784-788`) both do `if (source) push('--source') else push('--prompt')`.
   This is **exclusive**: a spec path is routed to `--source` and the prompt is discarded.
3. **Python** — `run_workspace.py` accepts `--source` (`src/worca/scripts/run_workspace.py:860`)
   but never resolves it; the master planner uses `args.prompt or ""`
   (`src/worca/scripts/run_workspace.py:1394`) → empty Work Request. There is no `--spec` arg.
   `create_workspace_manifest` also hardcodes `title=""`
   (`src/worca/scripts/run_workspace.py:280`). The child runner puts `--prompt`/`--source` in a
   **mutually-exclusive** argparse group with no `--spec`
   (`src/worca/scripts/run_worktree.py:222-224`).

User-facing impact: any fleet or workspace run using Specification (or GitHub Issue/PR while
also supplying a prompt) silently produces an empty work request and a no-op run.

## Proposal

Make fleet and workspace mirror the already-correct single-project run contract: the UI sends a
`source_type` discriminator alongside `source` + optional `prompt`; the server maps
`spec`→`--spec`, `source`→`--source`, and **always** passes `--prompt` when present; Python
resolves the work request through the existing `normalize()` / `build_work_request()` machinery,
merging any prompt as `## Additional Instructions`. For workspace children the spec file is also
threaded through the existing `--guide` mechanism as normative context.

## Design

### 0. Canonical reference (single-project run — already correct)

- **UI** `worca-ui/app/views/new-run.js:597-618`: sends `sourceType` (`none`/`source`/`spec`;
  `pr`→`source`) + `sourceValue` + optional `prompt`, all independent.
- **Server** `worca-ui/server/process-manager.js:529-560`: maps `'source'`→`--source`,
  `'spec'`→`--spec`, and ALWAYS `--prompt` when present (not exclusive).
- **Python** `src/worca/scripts/run_pipeline.py:104-149` `build_work_request(args)`: validates
  `--source` xor `--spec`; dispatches to `normalize("source"|"spec"|"plan"|"prompt", value)`
  (`src/worca/orchestrator/work_request.py:481`); merges an accompanying prompt as
  `\n\n## Additional Instructions\n\n{prompt}`. `normalize("spec", path)` →
  `normalize_spec_file()` (`src/worca/orchestrator/work_request.py:171-196`) reads the file — its
  contents become `work_request.description`.

The fix is feature parity with this contract.

### 1. Shared work-request resolver (Python)

- **Current state:** `build_work_request(args)` lives inside `run_pipeline.py:104-149` and reads
  five argparse attrs (`args.source`, `args.spec`, `args.plan`, `args.prompt`, `args.settings`).
- **Obstacle:** fleet/workspace/worktree runners can't reuse it — it's coupled to run_pipeline's
  Namespace, and their namespaces differ.
- **Resolution:** extract a pure helper taking explicit params, keep `build_work_request(args)` as
  a thin wrapper (backward compatible). All four runners call the shared helper.

```python
# src/worca/orchestrator/work_request.py  (new function)
def resolve_work_request(*, prompt=None, source=None, spec=None, plan=None,
                         settings_path=None) -> WorkRequest:
    """Canonical: validate, normalize, merge prompt as Additional Instructions."""
    if source and spec:
        raise ValueError("source and spec are mutually exclusive")
    if not any([prompt, source, spec, plan]):
        raise ValueError("one of prompt, source, spec, or plan is required")
    has_primary = source or spec or plan
    if source:
        tmpl = load_settings(settings_path).get("worca", {}).get("plan_path_template")
        wr = normalize("source", source, plan_path_template=tmpl)
    elif spec:
        wr = normalize("spec", spec)
    elif plan:
        wr = normalize("plan", plan)
    else:
        wr = normalize("prompt", prompt)
    if prompt and has_primary:
        wr.description = (wr.description + "\n\n## Additional Instructions\n\n" + prompt
                          if wr.description else "## Additional Instructions\n\n" + prompt)
    return wr
```

`run_pipeline.build_work_request(args)` becomes: `return resolve_work_request(prompt=args.prompt,
source=args.source, spec=args.spec, plan=args.plan, settings_path=args.settings)`.

### 2. Source-type inference (backward compat)

- **Current state:** `normalize()` already auto-detects `gh:`/`bd:`/URL when `source_type=="source"`
  (`src/worca/orchestrator/work_request.py:509`).
- **Obstacle:** old manifests (pre-W-076, or resume of in-flight runs) have no `source_type`.
- **Resolution:** one canonical sniffer, mirrored in Python and JS.

```python
# src/worca/orchestrator/work_request.py
def infer_source_type(value: str | None) -> str:
    if not value: return "none"
    if value.startswith(("gh:", "bd:")) or _ANY_URL_RE.match(value): return "source"
    if os.path.isfile(value): return "spec"
    return "source"  # let normalize() raise a clear error on unknown refs
```

```js
// worca-ui/server/app.js — mirrors work_request.infer_source_type (source of truth)
function sniffSourceType(value) {
  if (!value) return 'none';
  if (/^(gh:|bd:)/.test(value) || /^https?:\/\//.test(value)) return 'source';
  return 'spec'; // file-path assumption; server can't stat per-project paths reliably
}
```

### 3. Manifest data model

Add `source_type` to `work_request` in both fleet and workspace manifests. Enum:
`"none" | "source" | "spec"` (`pr` is mapped to `source` at the UI, matching `new-run.js:597`).

```json
"work_request": {
  "title": "<resolved wr.title>",
  "description": "<user prompt OR resolved contents>",
  "source": "<file path or gh:/bd: ref, null for prompt-only>",
  "source_type": "spec"
}
```

Verified: fleet/workspace manifests are **not** JSON-schema-validated on write (only
`workspace.json` topology and `workspace_plan.json` exist under `src/worca/schemas/`), so adding
the key is safe.

### 4. Server arg builder (shared)

- **Current state:** `buildWorkspaceArgs` (`app.js:80-84`) and `dispatchFleet` (`app.js:784-788`)
  duplicate the exclusive `if source else prompt` block.
- **Obstacle:** exclusive routing loses the prompt and mis-routes spec paths into `--source`.
- **Resolution:** one exported helper, used by both dispatchers.

```js
// worca-ui/server/app.js
export function appendWorkRequestArgs(args, work_request) {
  const wr = work_request || {};
  const type = wr.source_type || sniffSourceType(wr.source);
  if (type === 'spec' && wr.source) args.push('--spec', wr.source);
  else if (type === 'source' && wr.source) args.push('--source', wr.source);
  if (wr.description) args.push('--prompt', wr.description); // ALWAYS when present
}
```

Note the wire-field asymmetry: `new-run.js` sends camelCase `sourceType` in a JSON body, while
fleet/workspace use snake_case `source_type` in multipart FormData (consistent with existing
`head_template`, `plan_mode`). Document with a comment.

### 5. Workspace children get the spec as `--guide`

- **Current state:** `dag_executor._build_child_cmd` passes `--prompt` (master-plan-derived
  per-project slice) + `--guide` (repeatable) + `--plan` to `run_worktree.py`
  (`src/worca/workspace/dag_executor.py:116-123`). Children never see `--source`/`--spec`.
- **Obstacle:** the spec is normative context every child should honor; re-forwarding `--spec`
  per child would re-fetch gh/bd N times and the path may not exist in every worktree.
- **Resolution:** when `source_type == 'spec'`, `os.path.abspath` the spec and append it into the
  workspace `guide_paths` (`src/worca/scripts/run_workspace.py:1290`). It flows to manifest
  `guide.paths` → `dag_executor` `self._guide_paths` (`dag_executor.py:311`) → every child
  `--guide`. This matches the `guide > plan > description` authority model (CLAUDE.md § Guide
  Precedence). The spec is read twice (orchestrator gets contents via `normalize_spec_file`;
  children get it as a normative guide) — intentional.

### 6. Child runner blocker (`run_worktree.py`)

- **Current state:** `--prompt`/`--source` in a mutually-exclusive argparse group, no `--spec`
  (`src/worca/scripts/run_worktree.py:222-224`); local `normalize` if/elif at 296-303 with no
  prompt-merge; `build_worktree_cmd` forwards source XOR prompt.
- **Obstacle:** prompt+spec (or prompt+source) combos are structurally impossible — a hard blocker.
- **Resolution:** de-couple the group, add `--spec`, forward `--prompt`/`--source`/`--spec`
  independently to `run_pipeline` (which does the canonical merge — zero new resolve logic here).
  Replace the local normalize with `resolve_work_request()` for the title/slug it derives locally.

## Implementation Plan

Phases are vertical slices. Phases 1–3 fix the reported workspace bug end-to-end; phase 4 applies
the symmetric fleet fix; phase 5 hardens.

### Phase 1: Shared resolver + child-runner unblock (Python core)
**Files:** `src/worca/orchestrator/work_request.py`, `src/worca/scripts/run_pipeline.py`,
`src/worca/scripts/run_worktree.py`
**Tasks:**
1. Add `resolve_work_request(...)` and `infer_source_type(...)` to `work_request.py`; re-point
   `run_pipeline.build_work_request` (`run_pipeline.py:104`) at the shared helper.
2. `run_worktree.py:222-224`: de-couple the mutually-exclusive group, add `--spec`, allow
   `--prompt` alongside `--source`/`--spec`; update required-arg check (~292).
3. `run_worktree.py` `build_worktree_cmd` (~177-187): forward `--spec`/`--source`/`--prompt`
   independently. Replace local normalize (296-303) with `resolve_work_request`.
4. Tests: `resolve_work_request` merge/xor; `run_worktree` accepts `--prompt`+`--spec`.

### Phase 2: Workspace spec resolution (Python)
**Files:** `src/worca/scripts/run_workspace.py`
**Tasks:**
1. Parser (858-860): add `--spec`, allow `--prompt` with `--source`/`--spec`; update required-arg
   check (1250).
2. Resolve WorkRequest via `resolve_work_request` before planning. In `create_workspace_manifest`
   (245-302): set `title=wr.title` (**fix line 280**), `description=wr.description`, add
   `source_type`, store `source`. Fix any manifest rebuild near line 1486.
3. Master planner (1393-1395): replace `args.prompt or ""` with `wr.description`.
4. When `source_type=='spec'`: abspath spec, append to `guide_paths` (1290).
5. Tests: title non-empty; planner gets non-empty description; spec in `guide.paths` (abspath'd).

### Phase 3: Workspace server + UI wiring
**Files:** `worca-ui/server/app.js`, `worca-ui/server/workspace-routes.js`,
`worca-ui/app/views/fleet-launcher.js`
**Tasks:**
1. `app.js`: add `sniffSourceType` + `appendWorkRequestArgs`; replace `buildWorkspaceArgs:80-84`
   exclusive block with the helper.
2. `workspace-routes.js`: read `source_type` from multipart fields (~1182); persist to
   `work_request` (~1332-1336).
3. `fleet-launcher.js` workspace submit (~254-289): append `source_type`
   (`_hasSource() ? (sourceType==='pr'?'source':sourceType) : 'none'`).
4. Rebuild bundle (`cd worca-ui && npm run build`). → **reported bug fixed.**

### Phase 4: Fleet parity (symmetric)
**Files:** `src/worca/scripts/run_fleet.py`, `worca-ui/server/app.js`,
`worca-ui/server/fleet-routes.js`, `worca-ui/app/views/fleet-launcher.js`
**Tasks:**
1. `run_fleet.py`: add `--spec`, drop exclusive group, resolve fleet-level WR via
   `resolve_work_request`; manifest (934-937) add `source_type`; child dispatch — pass resolved
   `description` as `--prompt` and thread spec as `--guide` when `source_type=='spec'`.
2. `app.js` `dispatchFleet:784-788`: replace exclusive block with `appendWorkRequestArgs`.
3. `fleet-routes.js`: read + persist `source_type` (~721).
4. `fleet-launcher.js` fleet submit (~189-205): append `source_type`.

### Phase 5: Backward-compat + resume hardening
**Files:** `src/worca/scripts/run_workspace.py`, `src/worca/scripts/run_fleet.py`,
`worca-ui/server/app.js`
**Tasks:**
1. Use `infer_source_type` on manifests missing `source_type` (fleet legacy path ~517-518;
   workspace resume `_resume_workspace` ~1270).
2. Confirm JS resume dispatchers (`app.js:766-773`, `836-849`) rely on Python inference (they
   pass only `--resume`).

### Files Changed Summary

| File | Change |
|------|--------|
| `src/worca/orchestrator/work_request.py` | Add `resolve_work_request()`, `infer_source_type()` |
| `src/worca/scripts/run_pipeline.py` | `build_work_request` delegates to shared helper |
| `src/worca/scripts/run_worktree.py` | De-couple exclusive group, add `--spec`, independent forwarding |
| `src/worca/scripts/run_workspace.py` | Add `--spec`, resolve WR, fix `title`, feed planner, thread spec→guide, resume infer |
| `src/worca/scripts/run_fleet.py` | Add `--spec`, resolve WR, `source_type` manifest, child guide-threading, legacy infer |
| `worca-ui/server/app.js` | `appendWorkRequestArgs` + `sniffSourceType`; both dispatchers |
| `worca-ui/server/workspace-routes.js` | Read + persist `source_type` |
| `worca-ui/server/fleet-routes.js` | Read + persist `source_type` |
| `worca-ui/app/views/fleet-launcher.js` | Send `source_type` (both submit paths) |

## Considerations

- **Prompt semantics:** for fleet/workspace, the manifest stores the **user prompt** in
  `description` and the spec path in `source`. Passing `--prompt <description>` + `--spec <path>`
  reproduces the canonical merge downstream. `source_type=='none'` → only `--prompt`, byte-identical
  to today's behavior (no regression for existing prompt-only runs).
- **Spec read twice** (orchestrator contents + child guide) — intentional; the alternative
  (per-child `--spec`) re-fetches remote refs and breaks on worktree-relative paths.
- **Governance:** no change to dispatch governance, hooks, or the guardian commit gate. `--spec`
  is a launch-time arg, not an agent-invoked tool.
- **Breaking changes:** none. `source_type` is additive; absence is handled by `infer_source_type`.
  Existing prompt-only and gh-issue-only runs behave identically.
- **Migration:** no config-key migration. In-flight manifests resumed after upgrade fall through
  the sniffer. No user action required (nothing to add to MIGRATION.md unless the sniffer's
  file-path assumption needs documenting).
- **Known unknown:** JS `sniffSourceType` cannot `stat` per-project spec paths reliably (server
  may run global-mode), so it defaults an unknown non-ref value to `spec`; the authoritative
  discriminator is always the explicit `source_type` the UI now sends — the sniffer only covers
  legacy manifests.

## Test Plan

### Unit Tests
| Layer | Test | Validates |
|-------|------|-----------|
| Python | `test_resolve_work_request_spec_plus_prompt_merge` | Spec contents + prompt merged as Additional Instructions |
| Python | `test_resolve_work_request_source_xor_spec` | Raises on both source and spec |
| Python | `test_infer_source_type` | none / gh:/bd:/URL→source / file→spec |
| Python | `test_run_worktree_accepts_prompt_plus_spec` | Regression: exclusive group removed |
| Python | `test_run_worktree_cmd_forwards_spec_and_prompt` | `build_worktree_cmd` emits both independently |
| Python | `test_run_workspace_title_non_empty` | `create_workspace_manifest` uses `wr.title` |
| Python | `test_run_workspace_planner_gets_spec_description` | Master planner receives non-empty `wr.description` |
| Python | `test_run_workspace_spec_added_to_guides` | Spec abspath'd into `guide.paths` |
| Python | `test_run_fleet_spec_source_type_and_guide_threading` | `--spec` accepted, `source_type` persisted, spec→`--guide` |
| JS (vitest) | `fleet-launcher` submit appends `source_type` (fleet + workspace) | Discriminator sent; prompt always sent; pr→source |
| JS (vitest) | `app.js` `appendWorkRequestArgs` | Emits `--spec` vs `--source` + always `--prompt` |
| JS (vitest) | `sniffSourceType` legacy fallback | Manifest without `source_type` still routes correctly |
| JS (vitest) | workspace/fleet route persists `work_request.source_type` | Manifest write shape |

### Integration / E2E Tests
- Workspace integration test (`tests/integration/`) with a spec file source: assert
  `workspace-plan.json` carries the spec-derived work request (not "no user request"), children
  receive real `run_id`s, and the run does not complete instantly.
- Manual repro: launch the reported curl (workspace-runs, Specification source + prompt) and
  confirm the fetched manifest shows non-empty `title`/`description` and children with `run_id`.

### Existing Tests to Update
- `worca-ui/app/views/fleet-launcher.test.js` — assert the new `source_type` FormData field for
  both submit paths (add, not break).
- Any existing `run_workspace` / `run_fleet` manifest-shape assertions — add `source_type` key.
- `run_pipeline` tests referencing `build_work_request` — verify still green after delegation.

## Files to Create/Modify

No new files. Modify the nine files in the *Files Changed Summary* table above. Tests added to the
existing `tests/` (Python) and `worca-ui/**/*.test.js` (vitest) mirrors.

## Out of Scope

- Changing the single-project run path (already correct — it is the reference).
- Adding a *file-upload* spec option (spec is a path resolved per project root, matching the
  current UI hint) — only the path-based Specification type is wired.
- Beads (`bd:`) or non-GitHub PR providers beyond what `normalize()` already supports.
- A JSON schema for the fleet/workspace manifest (none exists today; out of scope to add one).
- Retroactively backfilling `source_type` into already-completed manifests on disk.
