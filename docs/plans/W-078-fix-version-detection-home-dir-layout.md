# W-078: Fix version detection and update for home-dir layout

**Status:** Draft
**Priority:** P1
**Area:** ui
**Date:** 2026-07-09
**Depends on:** None (builds on the home-dir relocation work on branch `worca/relocate-worca-runtime-to-home-directory-5ii`)

## Problem

With the home-dir layout, worca runtime moved from `<project>/.claude/worca/` to `~/.worca/pkg/<ver>/worca/`. Two functions in `worca-setup.js` still look for `.claude/worca/` inside the project tree:

- `checkWorcaInstalled()` at `worca-ui/server/worca-setup.js:18` checks `existsSync(join(projectPath, '.claude', 'worca'))` — always `false` with the new layout, so the UI shows projects as "not installed".
- `readProjectWorcaVersion()` at `worca-ui/server/worca-setup.js:27` reads `version.json` / `__init__.py` from `.claude/worca/` — files that no longer exist in the project, so version shows "unknown".

The registry entry (`~/.worca/projects.d/<slug>.json`) already carries the right data — `worcaConfigPath` and `worcaPkgVersion` — written by `update_registry_entry()` in `src/worca/utils/project_registry.py:124-126`. But no UI code reads these fields for version detection.

The update button (`POST /worca-setup` at `project-routes.js:1815`) spawns `worca init --upgrade` correctly, but after completion the status check still reports "unknown" because detection is broken.

Additionally, `buildProjectPreflight()` at `worca-ui/server/worca-setup-config.js:141` has a third hardcoded check — `existsSync(join(projectRoot, '.claude', 'worca'))` — used by the Project Setup wizard (step 1, "Your Project Environment"). This causes the setup dialog to show "Worca runtime · not installed" even for projects that were successfully initialized with the home-dir layout. The wizard uses this field to decide whether to show an "install worca" step (`project-setup-wizard.js:56`).

## Proposal

Add optional registry-data parameters to `checkWorcaInstalled` and `readProjectWorcaVersion`. Thread `worcaConfigPath` and `worcaPkgVersion` from registry entries through all call sites. Strip git-hash suffix from `worcaPkgVersion` before returning (registry stores `0.59.0-33ad2a9`, UI expects clean `0.59.0`). Preserve backwards compatibility with the legacy `.claude/worca/` layout via fallback.

## Design

### 1. Version detection functions (`worca-ui/server/worca-setup.js`)

- **Current state:** `worca-setup.js:18` — `checkWorcaInstalled(projectPath)` checks only `.claude/worca/`. `worca-setup.js:27` — `readProjectWorcaVersion(projectPath)` reads only from `.claude/worca/version.json` or `__init__.py`.
- **Obstacle:** Both functions take a bare `projectPath` string — no access to registry data.
- **Resolution:** Add optional second parameter for registry data. Home-dir check first, legacy fallback second.

```js
// before
export function checkWorcaInstalled(projectPath) {
  return existsSync(join(projectPath, '.claude', 'worca'));
}

// after
export function checkWorcaInstalled(projectPath, worcaConfigPath) {
  if (worcaConfigPath && existsSync(worcaConfigPath)) return true;
  return existsSync(join(projectPath, '.claude', 'worca'));
}
```

```js
// before
export function readProjectWorcaVersion(projectPath) {
  // tries version.json then __init__.py under .claude/worca/
}

// after
export function readProjectWorcaVersion(projectPath, worcaPkgVersion) {
  if (worcaPkgVersion) return worcaPkgVersion.replace(/-[0-9a-f]{7,}$/, '');
  // legacy fallback: version.json then __init__.py under .claude/worca/
}
```

**Hash stripping rationale:** `worcaPkgVersion` is produced by `version_key()` in `src/worca/utils/pkg_store.py:41-50` which appends `-<git-short-hash>` when inside a git repo. The UI badge displays this value directly (`settings.js:3267`) and `isVersionBehind()` (`version-check.js:71`) parses it for comparison. The old `__init__.py` returned clean semver (`0.59.0`). `parseInt("0-33ad2a9")` happens to return `0` (correct by accident), but displaying `0.59.0-33ad2a9` in the badge is ugly. The regex `/-[0-9a-f]{7,}$/` matches only trailing git short hashes, not RC suffixes (`rc3`, `-rc.5`).

### 2. Project resolver middleware (`worca-ui/server/project-routes.js`)

- **Current state:** `project-routes.js:148-160` — `req.project` carries `name`, `path`, `worcaDir`, `settingsPath`, `projectRoot`, `pm`. Does not include `worcaConfigPath` or `worcaPkgVersion`.
- **Obstacle:** Downstream handlers (`GET /worca-status` at line 1786) can't pass registry data to detection functions.
- **Resolution:** Add `worcaConfigPath` and `worcaPkgVersion` to `req.project`.

```js
// after — add two fields to req.project
req.project = {
  name: project.name,
  path: project.path,
  worcaDir,
  settingsPath: resolvedSettingsPath,
  worcaConfigPath: project.worcaConfigPath || null,
  worcaPkgVersion: project.worcaPkgVersion || null,
  projectRoot: projRoot,
  pm: new ProcessManager({ ... }),
};
```

### 3. Setup wizard preflight (`worca-ui/server/worca-setup-config.js`)

- **Current state:** `worca-setup-config.js:141` — `worcaInstalled` checks `existsSync(join(projectRoot, '.claude', 'worca'))`. The function signature accepts `{ projectRoot, settingsPath, graphifyStatus, crgStatus }` — no `worcaConfigPath`.
- **Obstacle:** `buildProjectPreflight` doesn't know about the home-dir layout. The wizard shows "Worca runtime · not installed" and offers an unnecessary install step.
- **Resolution:** Add optional `worcaConfigPath` to the function args. Use `checkWorcaInstalled(projectRoot, worcaConfigPath)` instead of inline `existsSync`.

```js
// before (worca-setup-config.js:130-142)
export async function buildProjectPreflight({
  projectRoot,
  settingsPath,
  graphifyStatus = null,
  crgStatus = null,
}) {
  const worcaInstalled =
    Boolean(projectRoot) && existsSync(join(projectRoot, '.claude', 'worca'));

// after
export async function buildProjectPreflight({
  projectRoot,
  settingsPath,
  worcaConfigPath = null,
  graphifyStatus = null,
  crgStatus = null,
}) {
  const worcaInstalled =
    Boolean(projectRoot) && checkWorcaInstalled(projectRoot, worcaConfigPath);
```

Call site at `project-routes.js:521` passes `req.project` fields — add `worcaConfigPath`:

```js
const payload = await buildProjectPreflight({
  projectRoot,
  settingsPath,
  worcaConfigPath: req.project.worcaConfigPath,
  graphifyStatus: req.app.locals.graphifyStatus || null,
  crgStatus: req.app.locals.crgStatus || null,
});
```

### 4. Call site updates (`project-routes.js`, `ws-modular.js`)

Five call sites need registry data threaded through:

| Call site | File:line | Available data | Change |
|-----------|-----------|----------------|--------|
| GET `/api/projects` enrichment | `project-routes.js:209` | `p` = full registry entry | `readProjectWorcaVersion(p.path, p.worcaPkgVersion)` |
| GET `/setup/preflight` | `project-routes.js:521` | `req.project` (after §2 fix) | Pass `worcaConfigPath` to `buildProjectPreflight` |
| GET `/worca-status` install check | `project-routes.js:1788` | `req.project` (after §2 fix) | `checkWorcaInstalled(projectRoot, req.project.worcaConfigPath)` |
| GET `/worca-status` version read | `project-routes.js:1797` | `req.project` (after §2 fix) | `readProjectWorcaVersion(projectRoot, req.project.worcaPkgVersion)` |
| WS `projects-updated` broadcast | `ws-modular.js:187` | `p` = full registry entry | `readProjectWorcaVersion(p.path, p.worcaPkgVersion)` |

### 4. Directory scanner (`worca-ui/server/project-registry.js`)

- **Current state:** `project-registry.js:157` — `scanDirectory(dirPath)` calls `checkWorcaInstalled(childPath)` with only a filesystem path. No access to `prefsDir` or registry entries.
- **Obstacle:** Can't detect home-dir installs without knowing `prefsDir`.
- **Resolution:** Add optional `prefsDir` parameter. For each discovered child, compute slug and check `existsSync(join(prefsDir, 'projects', slug, 'config.json'))`.

```js
// before
export async function scanDirectory(dirPath) {

// after
export async function scanDirectory(dirPath, prefsDir) {
  // ...
  const installed = prefsDir
    ? checkWorcaInstalled(childPath, join(prefsDir, 'projects', slugify(entry.name), 'config.json'))
    : checkWorcaInstalled(childPath);
```

Call site in `worca-ui/server/app.js:693` already has `prefsDir` in scope — pass it through.

## Implementation Plan

### Phase 1: Detection functions + call sites

**Files:** `worca-ui/server/worca-setup.js`, `worca-ui/server/worca-setup-config.js`, `worca-ui/server/project-routes.js`, `worca-ui/server/ws-modular.js`

**Tasks:**
1. Update `checkWorcaInstalled` signature and logic (`worca-setup.js:18`)
2. Update `readProjectWorcaVersion` signature and logic with hash stripping (`worca-setup.js:27`)
3. Add `worcaConfigPath` / `worcaPkgVersion` to `req.project` in `projectResolver` (`project-routes.js:148`)
4. Update `buildProjectPreflight` to accept `worcaConfigPath` and use `checkWorcaInstalled` (`worca-setup-config.js:130`)
5. Thread registry data at all five call sites (§4 table above)

### Phase 2: Directory scanner

**Files:** `worca-ui/server/project-registry.js`, `worca-ui/server/app.js`

**Tasks:**
1. Add optional `prefsDir` to `scanDirectory` (`project-registry.js:157`)
2. Pass `prefsDir` from `app.js:693`

### Phase 3: Tests

**Files:** `worca-ui/server/test/worca-status.test.js`

**Tasks:**
1. Add test: home-dir layout with `worcaConfigPath` + `worcaPkgVersion` → `installed: true`, version returned (hash stripped)
2. Add test: home-dir layout with `worcaConfigPath` only (no `worcaPkgVersion`) → `installed: true`, version `null`
3. Add test: no `.claude/worca/` and no `worcaConfigPath` → `installed: false`
4. Verify existing legacy tests still pass unchanged

### Files Changed Summary

| File | Change |
|------|--------|
| `worca-ui/server/worca-setup.js` | Add optional params to `checkWorcaInstalled`, `readProjectWorcaVersion`; hash stripping |
| `worca-ui/server/worca-setup-config.js` | Add `worcaConfigPath` param to `buildProjectPreflight`; delegate to `checkWorcaInstalled` |
| `worca-ui/server/project-routes.js` | Add fields to `req.project`; thread registry data at 4 call sites (projects list, preflight, worca-status ×2) |
| `worca-ui/server/ws-modular.js` | Thread `worcaPkgVersion` at line 187 |
| `worca-ui/server/project-registry.js` | Add optional `prefsDir` to `scanDirectory` |
| `worca-ui/server/app.js` | Pass `prefsDir` to `scanDirectory` call |
| `worca-ui/server/test/worca-status.test.js` | 3 new test cases for home-dir layout |
| `worca-ui/server/project-routes-setup-preflight.test.js` | Add test case for preflight with home-dir layout (`worcaConfigPath` present → `worcaInstalled: true`) |

## Considerations

- **Backwards compatibility:** Legacy projects with `.claude/worca/` still detected via fallback. No breaking changes.
- **Hash stripping regex:** `/-[0-9a-f]{7,}$/` won't match RC suffixes like `rc3` or `-rc.5` (no hex-only digits). Safe.
- **`worcaPkgVersion` not always present:** Old registry entries (created by UI before init ↔ UI unification) lack this field. Falls through to legacy detection → shows "unknown" until next `worca init --upgrade`. Acceptable.
- **`scanDirectory` without `prefsDir`:** When called without it (e.g. from tests), behaves exactly as before. Optional param preserves test compatibility.
- **No migration needed:** No config keys change. No user action required.

## Test Plan

### Unit Tests

| Layer | Test | Validates |
|-------|------|-----------|
| JS (vitest) | `worca-status: home-dir installed with version` | `checkWorcaInstalled` returns `true` via `worcaConfigPath`, version from `worcaPkgVersion` with hash stripped |
| JS (vitest) | `worca-status: home-dir installed no version` | `checkWorcaInstalled` returns `true`, version is `null` |
| JS (vitest) | `worca-status: not installed (no legacy, no config)` | `installed: false`, version `null` |
| JS (vitest) | `preflight: home-dir layout shows worcaInstalled` | `buildProjectPreflight` returns `worcaInstalled: true` when `worcaConfigPath` exists, no `.claude/worca/` |

### Existing Tests to Update

No existing tests should break — the new parameters are optional and all existing tests use the legacy `.claude/worca/` layout which continues to work via fallback.

Run: `cd worca-ui && npx vitest run server/`

## Out of Scope

- Polling or WS notification when `worca init --upgrade` completes (the 3-second `setTimeout` in the UI is a separate issue)
- Backfilling `worcaPkgVersion` on old registry entries that lack it (they self-heal on next `worca init --upgrade`)
- Changing `version_key()` format in Python — the hash is useful for pkg store GC and provenance
