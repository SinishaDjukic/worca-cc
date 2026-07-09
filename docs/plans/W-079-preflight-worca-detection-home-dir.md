# W-079: Fix setup wizard preflight worca detection for home-dir layout

**Status:** Draft
**Priority:** P1
**Area:** ui
**Date:** 2026-07-09
**Depends on:** W-078 (detection functions and call sites — already implemented)

## Problem

`buildProjectPreflight()` at `worca-ui/server/worca-setup-config.js:141-142` hardcodes the legacy install check:

```js
const worcaInstalled =
  Boolean(projectRoot) && existsSync(join(projectRoot, '.claude', 'worca'));
```

With the home-dir layout, `.claude/worca/` no longer exists in the project tree. The runtime lives at `~/.worca/pkg/<ver>/worca/` and the project config at `~/.worca/projects/<slug>/config.json`. This causes the Project Setup wizard (step 1, "Your Project Environment") to show "Worca runtime · not installed" even for projects that were successfully initialized.

W-078 already updated `checkWorcaInstalled()` in `worca-setup.js:18` to accept an optional `worcaConfigPath` parameter and check both layouts. But `buildProjectPreflight` doesn't use `checkWorcaInstalled` — it has its own inline `existsSync` check.

The setup wizard uses `worcaInstalled` to decide whether to show an "install worca" step (`project-setup-wizard.js:56-57`), so a false negative leads to an unnecessary install prompt.

## Proposal

Add optional `worcaConfigPath` to `buildProjectPreflight` and delegate to `checkWorcaInstalled` instead of the inline `existsSync`. Thread `worcaConfigPath` from `req.project` at both call sites (single-project preflight and workspace preflight).

## Design

### 1. `buildProjectPreflight` function (`worca-ui/server/worca-setup-config.js:130`)

- **Current state:** Function signature accepts `{ projectRoot, settingsPath, graphifyStatus, crgStatus }`. Install check at line 141-142 is an inline `existsSync`.
- **Obstacle:** No `worcaConfigPath` parameter, no import of `checkWorcaInstalled`.
- **Resolution:** Add `worcaConfigPath` to the destructured args, import and call `checkWorcaInstalled`.

```js
// before (worca-setup-config.js:22-26 — imports)
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { atomicWriteSync } from './atomic-write.js';
import { getDefaultBranch } from './git-helpers.js';
import { deepMerge } from './settings-merge.js';

// after — add import
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { atomicWriteSync } from './atomic-write.js';
import { getDefaultBranch } from './git-helpers.js';
import { deepMerge } from './settings-merge.js';
import { checkWorcaInstalled } from './worca-setup.js';
```

```js
// before (worca-setup-config.js:130-142)
export async function buildProjectPreflight({
  projectRoot,
  settingsPath,
  graphifyStatus = null,
  crgStatus = null,
}) {
  const isGitRepo =
    Boolean(projectRoot) && existsSync(join(projectRoot, '.git'));
  // worca is "installed" in a project when its runtime copy exists. Built-in
  // pipeline templates live under .claude/worca/templates/, so without this
  // the template step has nothing to offer.
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
  const isGitRepo =
    Boolean(projectRoot) && existsSync(join(projectRoot, '.git'));
  // worca is "installed" when the project has a config — either the legacy
  // .claude/worca/ dir or the home-dir layout config.json.
  const worcaInstalled =
    Boolean(projectRoot) && checkWorcaInstalled(projectRoot, worcaConfigPath);
```

Note: the old comment at line 138-140 references `.claude/worca/templates/` which is no longer accurate with the home-dir layout. Update it as shown above.

### 2. Call site: single-project preflight (`worca-ui/server/project-routes.js:518-526`)

- **Current state:** Passes `{ projectRoot, settingsPath, graphifyStatus, crgStatus }`. `req.project` already has `worcaConfigPath` (added by W-078 in `projectResolver`).
- **Resolution:** Add `worcaConfigPath: req.project.worcaConfigPath`.

```js
// before (project-routes.js:521-526)
const payload = await buildProjectPreflight({
  projectRoot,
  settingsPath,
  graphifyStatus: req.app.locals.graphifyStatus || null,
  crgStatus: req.app.locals.crgStatus || null,
});

// after
const payload = await buildProjectPreflight({
  projectRoot,
  settingsPath,
  worcaConfigPath: req.project.worcaConfigPath,
  graphifyStatus: req.app.locals.graphifyStatus || null,
  crgStatus: req.app.locals.crgStatus || null,
});
```

### 3. Call site: workspace preflight (`worca-ui/server/workspace-routes.js:869-874`)

- **Current state:** Iterates `workspace.json` projects, constructs `projectRoot` and `settingsPath` inline. No access to registry entries or `prefsDir`.
- **Obstacle:** No `worcaConfigPath` available. Need to compute it from the project directory name (matching how `worca init` registers projects: `slugify(basename(project_root))`).
- **Resolution:** Compute `worcaConfigPath` inline using `worcaHome()` from `paths.js` (honors `$WORCA_HOME` — test-safe) and `slugify(basename(projectRoot))` (matches the Python registry slug computation). Import both.

```js
// new imports needed in workspace-routes.js (basename + join already imported at line 23)
import { slugify } from './project-registry.js';
import { worcaHome } from './paths.js';
```

```js
// before (workspace-routes.js:867-874)
const projectRoot = join(reg.path, p.path);
const settingsPath = join(projectRoot, '.claude', 'settings.json');
const pf = await buildProjectPreflight({
  projectRoot,
  settingsPath,
  graphifyStatus,
  crgStatus,
});

// after
const projectRoot = join(reg.path, p.path);
const settingsPath = join(projectRoot, '.claude', 'settings.json');
const worcaConfigPath = join(
  worcaHome(), 'projects', slugify(basename(projectRoot)), 'config.json',
);
const pf = await buildProjectPreflight({
  projectRoot,
  settingsPath,
  worcaConfigPath,
  graphifyStatus,
  crgStatus,
});
```

**Why `basename(projectRoot)` not `p.name`:** `worca init` registers projects via `slugify(os.path.basename(project_root))` in `project_registry.py:48`. The workspace.json `name` field may differ from the directory name. Using `basename(projectRoot)` ensures slug matches what init wrote.

**Why `worcaHome()` not `homedir()`:** `worcaHome()` in `paths.js:20` honors `$WORCA_HOME`, matching the Python `worca.utils.paths.worca_home()`. Using raw `homedir()` would break tests that override `$WORCA_HOME`.

## Implementation Plan

### Phase 1: Function + call sites

**Files:** `worca-ui/server/worca-setup-config.js`, `worca-ui/server/project-routes.js`, `worca-ui/server/workspace-routes.js`

**Tasks:**
1. Add `import { checkWorcaInstalled } from './worca-setup.js'` to `worca-setup-config.js`
2. Add `worcaConfigPath` param to `buildProjectPreflight` and delegate to `checkWorcaInstalled` (`worca-setup-config.js:130-142`)
3. Pass `worcaConfigPath` from `req.project` at `project-routes.js:521`
4. Compute and pass `worcaConfigPath` at `workspace-routes.js:869` (add `homedir`/`slugify` imports if needed)

### Phase 2: Tests

**Files:** `worca-ui/server/worca-setup-config.test.js` (unit), `worca-ui/server/project-routes-setup-preflight.test.js` (integration)

**Tasks:**
1. In `worca-setup-config.test.js` (where `buildProjectPreflight` tests live at line 134): add test calling `buildProjectPreflight({ projectRoot, settingsPath, worcaConfigPath })` with `worcaConfigPath` pointing to an existing file, no `.claude/worca/` dir → assert `worcaInstalled: true`
2. In `worca-setup-config.test.js`: add test with no `worcaConfigPath` and no `.claude/worca/` → assert `worcaInstalled: false` (already implicitly tested by existing tests, but make it explicit)
3. In `project-routes-setup-preflight.test.js`: add integration test via `GET /setup/preflight` where the registry entry has `worcaConfigPath` pointing to existing file → assert response `worcaInstalled: true`. This test must write the registry entry with `writeProject(prefsDir, { name, path, worcaConfigPath })` so `projectResolver` threads it through.
4. Verify existing tests still pass (none create `.claude/worca/`, so `worcaInstalled` was already `false` in all existing tests — no breakage expected)

### Files Changed Summary

| File | Change |
|------|--------|
| `worca-ui/server/worca-setup-config.js` | Import `checkWorcaInstalled`; add `worcaConfigPath` param; delegate install check |
| `worca-ui/server/project-routes.js` | Pass `worcaConfigPath` to `buildProjectPreflight` at line 521 |
| `worca-ui/server/workspace-routes.js` | Compute `worcaConfigPath` from slug + homedir; pass to `buildProjectPreflight` at line 869 |
| `worca-ui/server/worca-setup-config.test.js` | Add 2 unit tests for `buildProjectPreflight` with `worcaConfigPath` |
| `worca-ui/server/project-routes-setup-preflight.test.js` | Add integration test via HTTP with registry entry carrying `worcaConfigPath` |

## Considerations

- **Backwards compatibility:** `worcaConfigPath` defaults to `null`. Existing callers and tests pass no value → legacy `existsSync(.claude/worca)` fallback via `checkWorcaInstalled`. No breaking changes.
- **Workspace routes and `worcaHome()`:** Must use `worcaHome()` from `paths.js` (not raw `homedir()`) to honor `$WORCA_HOME` — otherwise tests that override `$WORCA_HOME` leak into the real home directory. The slug must be computed from `basename(projectRoot)` (not `p.name` from workspace.json) to match what `worca init` writes via `slugify(os.path.basename(project_root))` in `project_registry.py:48`.
- **Circular import risk:** `worca-setup-config.js` importing from `worca-setup.js` — verify no circular dependency. `worca-setup.js` has no imports from `worca-setup-config.js`, so this is safe.

## Test Plan

### Unit Tests

| Layer | Test | Validates |
|-------|------|-----------|
| JS (vitest) | `buildProjectPreflight: home-dir layout worcaInstalled` (unit, `worca-setup-config.test.js`) | Returns `worcaInstalled: true` when `worcaConfigPath` exists, no `.claude/worca/` |
| JS (vitest) | `buildProjectPreflight: neither layout present` (unit, `worca-setup-config.test.js`) | Returns `worcaInstalled: false` when both checks fail |
| JS (vitest) | `GET /setup/preflight: home-dir worcaInstalled` (integration, `project-routes-setup-preflight.test.js`) | HTTP endpoint returns `worcaInstalled: true` via registry entry with `worcaConfigPath` |

### Existing Tests to Update

None — existing tests use `.claude/worca/` layout which continues to work via `checkWorcaInstalled` fallback.

Run: `cd worca-ui && npx vitest run server/`

## Out of Scope

- Other detection sites (already fixed in W-078: `checkWorcaInstalled`, `readProjectWorcaVersion`, `projectResolver`, `scanDirectory`, `worca-status`, `ws-modular`)
- Template discovery path (templates at `~/.worca/pkg/<ver>/worca/templates/` — separate concern)
