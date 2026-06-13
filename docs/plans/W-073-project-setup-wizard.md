# W-073: Project Setup Wizard

**Status:** Draft
**Priority:** P2
**Area:** ui
**Date:** 2026-06-13
**Depends on:** None

## Problem

Adding a project to worca today offers no guided configuration. Users must discover
graphify, CRG, base branch settings, and pipeline templates by exploring the Settings
page independently — or not at all. As a result, most projects run with defaults that
don't match the repository (e.g. PRs targeting `main` when the repo uses `master`,
graphify disabled even though it is installed).

The Settings → Projects tab (`settings.js:3149–3246`) also uses a dated flex-list
layout inconsistent with the Workspaces table (`workspaces-config.js:37–121`), which
already renders a clean `<table>` with icon-only action buttons.

**User-facing impact:** Silent misconfiguration on first run; no recovery path short
of manually editing settings.json; visual inconsistency between the Projects and
Workspaces settings tabs.

## Proposal

Add a 5-step UI-only setup wizard dialog (Preflight → Base Branch → Optional Tools →
Default Template → Complete) that opens automatically after adding a project or
workspace, and is re-triggerable at any time from the Settings page. Rework the
Projects tab to use the same table layout as Workspaces with text-less icon action
buttons while preserving version badges. Add a Setup gear icon to the Workspaces
actions column for workspace re-configuration.

No changes to `worca init` CLI or any Python code.

## Design

### 1. Settings → Projects Tab: flex-list → table

**Current state:** `settings.js:3213–3246` renders a `<div class="projects-list">`
of flex items, each with text buttons "Update" and "Remove" and an inline `sl-badge`.

**Obstacle:** Layout is visually inconsistent with `workspaces-config.js:37` which
uses a `<table>` with icon-only `ws-action-btn` buttons. The Projects tab also has
no Setup entry point.

**Resolution:** Replace the flex-list with a `<table>` following the workspaces
pattern. Columns: **Name**, **Path**, **worca-cc** (version badge), **Actions**.
Actions column gets three icon buttons — RefreshCw (Update), Settings (Setup), Trash2
(Remove) — with `sl-tooltip` labels, matching the workspaces `ws-action-btn` style.

Version badge coloring logic (`settings.js:3222`) is preserved exactly:
- `warning` — version unknown or behind active worca-cc
- `success` — up to date
- `neutral` — active version not yet loaded

```
Before (flex-list):
  <div class="projects-list-item">
    <div>name / path</div>
    <div>badge + [Update] [Remove]</div>
  </div>

After (table row):
  <tr>
    <td>name</td>
    <td><code>path</code></td>
    <td><sl-badge ...>worca-cc: x.y.z</sl-badge></td>
    <td class="proj-actions">
      <sl-tooltip "Update worca"><button class="proj-action-btn">↺</button></sl-tooltip>
      <sl-tooltip "Project setup"><button class="proj-action-btn">⚙</button></sl-tooltip>
      <sl-tooltip "Remove project"><button class="proj-action-btn proj-action-btn--danger">🗑</button></sl-tooltip>
    </td>
  </tr>
```

The `onProjectSetup` callback is threaded up from `projectsTab()` to `settingsView()`
alongside the existing `onProjectAdd` / `onProjectRemove` / `onProjectsRefresh`.

### 2. Wizard Dialog: 5-Step Flow

**New file:** `worca-ui/app/views/project-setup-wizard.js`

The dialog uses `sl-dialog` with a fixed CSS width (`--setup-wizard-width: 480px`)
applied via `::part(panel)` to prevent content-width jumping between steps.

A step indicator renders at the top of the dialog body: filled circles for completed
steps, a highlighted circle for the active step, connected by lines. Completed steps
show a ✓ glyph.

The dialog accepts these props:
```js
projectSetupWizardView(project, {
  isWorkspace: false,   // true for workspace variant
  projectCount: 1,      // used in "Applies to N projects" label (workspace only)
  onClose,              // called when wizard is dismissed or Done is clicked
})
```

**Step table:**

| # | Title (shown below indicator) | Skippable | Footer left | Footer right |
|---|-------------------------------|-----------|-------------|--------------|
| 1 | Preflight | Yes — exits wizard | Skip Setup | Continue → |
| 2 | PR Base Branch | Yes — keep detected value | ← Back · Skip | Next → |
| 3 | Optional Tools | Yes — no changes written | ← Back · Skip | Next → |
| 4 | Default Template | Yes — no default set | ← Back · Skip | Next → |
| 5 | Complete | — | — | Done |

Skipping the entire wizard from step 1 (Skip Setup) writes nothing and closes the
dialog. Skipping individual steps advances without writing that step's value.
Configuration is written step-by-step on Next (not batched at the end), so partial
completion is preserved if the dialog is closed mid-flow.

### 3. Step Content

#### Step 1 — Preflight

Fetches `GET /api/projects/:id/setup/preflight` on mount and renders a read-only
checklist:

```
✓  Git repository detected
✓  PR base branch detected  ·  master
✓  Graphify installed
✗  CRG not installed
```

Each row shows ✓ (green) / ✗ (muted) based on the API response. The step is
informational only — no user input. "Continue →" advances to step 2.

ASCII mockup:
```
┌──────────────────────────────────────────────────────┐
│ Project Setup                                    [×]  │
├──────────────────────────────────────────────────────┤
│  ●───○───○───○───○                                   │
│  Preflight                                           │
├──────────────────────────────────────────────────────┤
│                                                      │
│  Checking your project environment...                │
│                                                      │
│  ✓  Git repository detected                          │
│  ✓  PR base branch detected  ·  master               │
│  ✓  Graphify installed                               │
│  ✗  CRG not installed                                │
│                                                      │
├──────────────────────────────────────────────────────┤
│  [Skip Setup]                          [Continue →]  │
└──────────────────────────────────────────────────────┘
```

#### Step 2 — PR Base Branch

Pre-populates an `sl-select` (or `sl-input`) with the branch detected by the preflight
endpoint. The user confirms or edits it. On Next, writes `parallel.default_base_branch`
to the project settings via `PATCH /api/projects/:id/settings`.

```
┌──────────────────────────────────────────────────────┐
│ Project Setup                                    [×]  │
├──────────────────────────────────────────────────────┤
│  ✓───●───○───○───○                                   │
│  PR Base Branch                                      │
├──────────────────────────────────────────────────────┤
│                                                      │
│  New pull requests will target this branch.          │
│                                                      │
│  Base branch                                         │
│  ┌──────────────────────────────────────────────┐   │
│  │ master                                     ▾ │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  Detected from git remote.                           │
│                                                      │
├──────────────────────────────────────────────────────┤
│  [← Back]                        [Skip]  [Next →]   │
└──────────────────────────────────────────────────────┘
```

#### Step 3 — Optional Tools

Reuses existing `/api/graphify/status?project=X` and `/api/crg/status?project=X`
to determine installed/not-installed state. Does not duplicate status-fetching logic.

- **Installed:** shows a toggle (enabled/disabled) that writes `worca.graphify.enabled`
  or `worca.code_review_graph.enabled` on change.
- **Not installed:** shows the install command with a copy button and a "Check again"
  button that re-fetches the status endpoint.

```
┌──────────────────────────────────────────────────────┐
│ Project Setup                                    [×]  │
├──────────────────────────────────────────────────────┤
│  ✓───✓───●───○───○                                   │
│  Optional Tools                                      │
├──────────────────────────────────────────────────────┤
│                                                      │
│  Graphify                         installed  [● on]  │
│  Code knowledge graph for smarter planning           │
│                                                      │
│  ─────────────────────────────────────────────────  │
│                                                      │
│  CRG                              not installed      │
│  Static code-review graph                            │
│                                                      │
│  uv tool install crg                        [Copy]   │
│                                   [Check again]      │
│                                                      │
├──────────────────────────────────────────────────────┤
│  [← Back]                        [Skip]  [Next →]   │
└──────────────────────────────────────────────────────┘
```

#### Step 4 — Default Template

Fetches the template list from `GET /api/templates` and renders a card-picker. Each
card shows the template name; selecting it shows its description below. A final
option "No default — choose per run" clears `worca.default_template`. On Next, writes
`worca.default_template` to project settings.

**Single-project variant:**

```
┌──────────────────────────────────────────────────────┐
│ Project Setup                                    [×]  │
├──────────────────────────────────────────────────────┤
│  ✓───✓───✓───●───○                                   │
│  Default Template                                    │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │
│  │   feature    │ │  quick-fix ● │ │    bugfix    │ │
│  └──────────────┘ └──────────────┘ └──────────────┘ │
│  ┌──────────────┐                                    │
│  │   refactor   │                                    │
│  └──────────────┘                                    │
│                                                      │
│  quick-fix                                           │
│  Fast single-bead fix. Plan review and PR            │
│  approval skipped. Best for small changes.           │
│                                                      │
│  ○  No default — choose per run                      │
│                                                      │
├──────────────────────────────────────────────────────┤
│  [← Back]                        [Skip]  [Next →]   │
└──────────────────────────────────────────────────────┘
```

**Workspace variant:** same layout, but only builtin and user-tier templates are
listed. A label above the card picker reads: *"Only globally accessible templates are
shown. Project-specific templates can be configured per project later."* A note at
the bottom: *"Applies to all N projects in this workspace."*

```
┌──────────────────────────────────────────────────────┐
│ Workspace Setup                                  [×]  │
├──────────────────────────────────────────────────────┤
│  ✓───✓───✓───●───○                                   │
│  Default Template                                    │
├──────────────────────────────────────────────────────┤
│                                                      │
│  Only builtin and user templates are listed.         │
│  Project templates can be set per project later.     │
│                                                      │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │
│  │   feature ●  │ │  quick-fix   │ │    bugfix    │ │
│  └──────────────┘ └──────────────┘ └──────────────┘ │
│                                                      │
│  feature                                             │
│  Full pipeline with plan review. Best for new        │
│  features and larger changes.                        │
│                                                      │
│  ○  No default — choose per run                      │
│                                                      │
│  Applies to all 4 projects in this workspace.        │
│                                                      │
├──────────────────────────────────────────────────────┤
│  [← Back]                        [Skip]  [Next →]   │
└──────────────────────────────────────────────────────┘
```

#### Step 5 — Complete

Summarises what was configured (each applied step shows ✓, each skipped step shows –).
A non-blocking hint card at the bottom points to the Integrations settings page.
The "Done" button closes the dialog and calls `onClose`.

```
┌──────────────────────────────────────────────────────┐
│ Project Setup                                    [×]  │
├──────────────────────────────────────────────────────┤
│  ✓───✓───✓───✓───●                                   │
│  Complete                                            │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ✓  Base branch set to master                        │
│  ✓  Graphify enabled                                 │
│  –  CRG skipped (not installed)                      │
│  ✓  Default template: quick-fix                      │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  Get notified when runs complete               │  │
│  │  Set up Slack, Discord, or Telegram →          │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
├──────────────────────────────────────────────────────┤
│                                            [Done]    │
└──────────────────────────────────────────────────────┘
```

### 4. New API Endpoint: Preflight

`GET /api/projects/:id/setup/preflight`

Runs in `worca-ui/server/project-routes.js`. Returns:

```json
{
  "baseBranch": "master",
  "graphifyInstalled": true,
  "crgInstalled": false,
  "currentSettings": {
    "baseBranch": null,
    "graphifyEnabled": false,
    "crgEnabled": false,
    "defaultTemplate": null
  }
}
```

- `baseBranch`: calls the existing `getDefaultBranch(projectPath)` logic in
  `git-helpers.js:21` (`getDefaultBranch`, which calls `symbolic-ref refs/remotes/origin/HEAD --short`), falling
  back to `main` if unresolvable.
- `graphifyInstalled` / `crgInstalled`: calls `graphifyStatus.detect()` /
  `crgStatus.detect()` — already available via `app.locals.graphifyStatus` and
  `app.locals.crgStatus`.
- `currentSettings`: reads the project's existing worca settings so the wizard
  pre-populates fields on re-trigger.

No new modules required — this endpoint is a thin aggregator over existing helpers.

### 5. Workspace Variant

The wizard opens with `isWorkspace: true` when triggered from the workspace flow.
The dialog title changes to "Workspace Setup". Step 4 filters the template list to
builtin + user tiers only (excludes any `project`-tier entries).

On apply, workspace wizard writes to each child project's settings individually via
sequential `PATCH /api/projects/:id/settings` calls. No workspace-level config file
is introduced — workspace.json remains a pure DAG definition.

### 6. Trigger Points

**After adding a project** — `add-project-dialog.js:237` currently offers the
batch worca-setup dialog after registration. After that flow completes, the wizard
opens automatically. The existing batch-setup dialog is unchanged; the wizard opens
as a second step specifically for configuration (not installation).

**After creating a workspace** — `workspace-create.js:92` calls `onCreated?.(workspaceName)`
on success. The caller opens the workspace wizard variant immediately after.

**Re-trigger from Projects tab** — the new Setup icon button in `projectsTab()` calls
`onProjectSetup?.(p.name)`, which opens the wizard pre-populated from current settings.

**Re-trigger from Workspaces tab** — a new Settings gear icon (using the `Settings`
Lucide icon already imported in `settings.js:26`) is added between the Edit pencil
and Delete trash icon in `workspaces-config.js:89`. It calls a new `onSetup?.(d.name)`
callback.

## Implementation Plan

### Phase 1: Projects Tab Rework

**Files:** `worca-ui/app/views/settings.js`

1. Replace `<div class="projects-list">` (`settings.js:3213`) with a `<table>` following
   the `workspaces-config.js:37` pattern — same column structure.
2. Add **Name**, **Path**, **worca-cc** (badge), **Actions** columns.
3. Replace text buttons with icon buttons: RefreshCw (Update), Settings (Setup), Trash2
   (Remove). Add `sl-tooltip` wrappers. Re-use `.ws-action-btn` class or create `.proj-action-btn`.
4. Add `onProjectSetup` to the `projectsTab()` signature and wire the Setup button.
5. Thread `onProjectSetup` through `settingsView()`.

### Phase 2: Preflight API Endpoint

**Files:** `worca-ui/server/project-routes.js`

1. Add `GET /api/projects/:id/setup/preflight` route.
2. Resolve project path from registry, call `getDefaultBranch`, read graphify/crg
   install state from `app.locals.graphifyStatus.detect()` / `app.locals.crgStatus.detect()`.
3. Read current project settings for pre-population.
4. Return the JSON schema described in Design §4.

### Phase 3: Wizard Dialog Component

**Files:** `worca-ui/app/views/project-setup-wizard.js` (new)

1. Implement the 5-step dialog with step-indicator, fixed-width panel, and per-step
   content components.
2. Internal state: `{ step, preflight, baseBranch, graphifyEnabled, crgEnabled, template, applied }`.
3. Step 1 fetches the preflight endpoint on mount.
4. Steps 2–4 write to project settings via existing `PATCH /api/projects/:id/settings`
   on "Next". Step 3 tool toggles write immediately on change.
5. Step 4 fetches templates from `GET /api/templates`, filters by tier for workspace
   variant.
6. Export `projectSetupWizardView(project, options)`.

### Phase 4: Trigger Point Wiring

**Files:** `worca-ui/app/views/add-project-dialog.js`, `worca-ui/app/views/workspace-create.js`,
`worca-ui/app/views/settings.js`, `worca-ui/app/views/workspaces-config.js`,
`worca-ui/app/main.js`

1. `add-project-dialog.js` — after project registration completes successfully, call
   a new `onSetupProject?.(projectName)` callback.
2. `workspace-create.js` — after `onCreated?.()` fires, the parent opens the workspace
   wizard variant.
3. `workspaces-config.js` — add Settings icon button to the actions column; add
   `onSetup` to the function signature.
4. `main.js` (or wherever dialogs are managed) — wire `onSetupProject` and `onSetupWorkspace`
   handlers that open the wizard dialog.

### Files Changed Summary

| File | Change |
|------|--------|
| `worca-ui/app/views/settings.js` | Replace `projectsTab` flex-list with table; add `onProjectSetup` callback |
| `worca-ui/app/views/project-setup-wizard.js` | **New** — 5-step wizard dialog |
| `worca-ui/server/project-routes.js` | Add `GET /api/projects/:id/setup/preflight` |
| `worca-ui/app/views/add-project-dialog.js` | Add `onSetupProject` callback after successful registration |
| `worca-ui/app/views/workspace-create.js` | Add `onSetupWorkspace` callback after successful create |
| `worca-ui/app/views/workspaces-config.js` | Add Settings icon button; add `onSetup` callback |
| `worca-ui/app/main.js` | Wire wizard open handlers for projects and workspaces |
| `worca-ui/app/styles.css` | `.proj-action-btn` table styles; `--setup-wizard-width` |

## Considerations

- **No CLI changes.** `worca init` is untouched. The wizard only writes worca settings
  keys — not pipeline files.
- **Idempotent.** Re-triggering the wizard reads current settings and pre-populates;
  it can be run repeatedly without side effects.
- **Partial completion.** Config is written step-by-step on Next, not batched. A user
  who closes mid-wizard retains whatever was written up to that point.
- **Workspace apply order.** Writing to N child projects sequentially is fine for typical
  workspace sizes (2–10 projects). No batching needed.
- **Template tier display.** The wizard fetches from `GET /api/templates` which already
  returns tier metadata. Filtering to builtin + user in the workspace variant is a
  client-side filter on `tier !== 'project'`.
- **No setup-complete flag.** The wizard is always re-triggerable. No persistent marker
  is stored — the Setup button is always present in the actions column.
- **Breaking changes:** None. The Projects tab visual change is additive; button
  callbacks are renamed but wired through new props.

## Test Plan

### Unit Tests (vitest)

| File | Test | Validates |
|------|------|-----------|
| `settings-projects.test.js` | Projects tab renders table columns | Table structure: Name, Path, worca-cc, Actions |
| `settings-projects.test.js` | Version badge variant for behind/current/unknown | Badge coloring preserved |
| `settings-projects.test.js` | Setup button calls `onProjectSetup` with project name | Callback wiring |
| `project-setup-wizard.test.js` (new) | Step 1 renders preflight results | ✓/✗ rows based on API response |
| `project-setup-wizard.test.js` | Skip Setup from step 1 closes dialog without writing | No PATCH calls |
| `project-setup-wizard.test.js` | Skip on step 2 advances without writing base branch | No base_branch PATCH |
| `project-setup-wizard.test.js` | Next on step 2 writes `parallel.default_base_branch` | PATCH called with correct key |
| `project-setup-wizard.test.js` | Tool toggle writes graphify/crg enabled immediately | PATCH on toggle change |
| `project-setup-wizard.test.js` | Workspace variant filters project templates from step 4 | Only builtin+user shown |
| `project-setup-wizard.test.js` | Workspace variant shows "Applies to N projects" label | Label present |
| `project-setup-wizard.test.js` | Done button calls `onClose` | Callback fires |

### API Tests (vitest, server)

| File | Test | Validates |
|------|------|-----------|
| `project-routes-setup-preflight.test.js` (new) | Returns `baseBranch` from git detection | Correct branch string |
| `project-routes-setup-preflight.test.js` | Returns `graphifyInstalled: false` when not present | Detects absence |
| `project-routes-setup-preflight.test.js` | Returns `currentSettings` pre-populated | Reads project settings |

### E2E Tests (Playwright)

| Spec | Scenario | Validates |
|------|----------|-----------|
| `e2e/project-setup-wizard.spec.js` (new) | Add project → wizard opens automatically | Wizard auto-opens |
| `e2e/project-setup-wizard.spec.js` | Complete all steps → settings written | Config persisted in settings.json |
| `e2e/project-setup-wizard.spec.js` | Skip Setup → no settings written | No mutation on skip |
| `e2e/project-setup-wizard.spec.js` | Setup button in Projects tab re-opens wizard | Re-trigger path |
| `e2e/workspaces-setup.spec.js` (new) | Create workspace → workspace wizard opens | Workspace trigger |
| `e2e/workspaces-setup.spec.js` | Workspace Setup gear icon in settings | Gear icon present and functional |

### Existing Tests to Update

- `worca-ui/app/views/settings-projects.test.js` — update selectors for table layout
  (currently tests flex-list structure).
- `worca-ui/app/views/workspace-create.test.js` — add assertion that `onSetupWorkspace`
  is called after successful creation.

## Files to Create/Modify

| File | Type | Change |
|------|------|--------|
| `worca-ui/app/views/project-setup-wizard.js` | **Create** | New 5-step wizard dialog component |
| `worca-ui/app/views/project-setup-wizard.test.js` | **Create** | Unit tests for wizard steps |
| `worca-ui/server/project-routes-setup-preflight.test.js` | **Create** | API tests for preflight endpoint |
| `worca-ui/e2e/project-setup-wizard.spec.js` | **Create** | E2E wizard flow tests |
| `worca-ui/e2e/workspaces-setup.spec.js` | **Create** | E2E workspace wizard tests |
| `worca-ui/app/views/settings.js` | **Modify** | Projects tab: flex-list → table, add Setup button |
| `worca-ui/server/project-routes.js` | **Modify** | Add preflight endpoint |
| `worca-ui/app/views/add-project-dialog.js` | **Modify** | Fire `onSetupProject` after registration |
| `worca-ui/app/views/workspace-create.js` | **Modify** | Fire `onSetupWorkspace` after create |
| `worca-ui/app/views/workspaces-config.js` | **Modify** | Add Settings gear icon; `onSetup` callback |
| `worca-ui/app/main.js` | **Modify** | Wire wizard open handlers |
| `worca-ui/app/styles.css` | **Modify** | `.proj-action-btn` table styles; wizard fixed width |

## Out of Scope

- CLI changes to `worca init` or any Python code.
- A "setup complete" persistent marker or setup banner (wizard is always re-triggerable).
- CLAUDE.md hint for test command discovery (covered by existing CLAUDE.md instructions, not the wizard).
- API key / backend endpoint validation (users may use non-Anthropic backends).
- Effort cap configuration in the wizard.
- Per-project template overrides within the workspace wizard (always per-project via Settings).
- Workspace-level config storage in workspace.json (each project's settings.json is written independently).
