# Plan: Add Run & Branch Identifier to Beads Details View

## Problem

When viewing the beads kanban for a specific run (`#/beads?run=<runId>`), there is no metadata showing which run ID or git branch the beads belong to. The content header shows the work request title, but the run identifier (e.g. `20260322-161722`) and branch name (e.g. `worca/add-css-styles-7m8u`) are absent. The run detail view already has a `run-info-section` with branch/timing metadata — the beads detail view should follow the same pattern for consistency.

## Approach

Add a metadata strip between the content header and the beads kanban filters, reusing the existing `run-info-section` / `run-branch` CSS pattern from `run-detail.js`. The data is already available in `state.runs[route.runId]` — no server changes needed.

## Changes

### 1. `main.js` — Pass run data to `beadsPanelView`

**File:** `.claude/worca-ui/app/main.js`

In `mainContentView()` (line ~908), when rendering `beadsPanelView` for a specific run, pass the `run` object as a new option:

```js
const run = state.runs[route.runId];
return beadsPanelView(beadsRunIssues, {
  // ...existing options...
  run,        // ← new
  runId: route.runId,  // ← new (fallback identifier)
});
```

### 2. `beads-panel.js` — Render run/branch metadata strip

**File:** `.claude/worca-ui/app/views/beads-panel.js`

Add a metadata section at the top of the `beadsPanelView` output, above the filters. Destructure `run` and `runId` from options. Render:

- **Run ID** — with a `Hash` icon and the run ID value (e.g. `20260322-161722`)
- **Branch** — with a `GitBranch` icon and the branch name (reuse `run-branch` class)
- **PR link** — if `run.pr_url` exists, show "View PR" link (same as run-detail)

Template structure:
```js
const branch = run?.branch || run?.work_request?.branch || '';
const displayRunId = runId || run?.run_id || '';
const pr = run?.pr_url || null;

const metaStripView = (branch || displayRunId) ? html`
  <div class="run-info-section">
    ${displayRunId ? html`
      <div class="run-branch">
        <span class="stage-meta-icon">${unsafeHTML(iconSvg(Hash, 14))}</span>
        <span>Run ${displayRunId}</span>
      </div>
    ` : nothing}
    ${branch ? html`
      <div class="run-branch">
        <span class="stage-meta-icon">${unsafeHTML(iconSvg(GitBranch, 14))}</span>
        <span>${branch}</span>
        ${pr ? html`<a class="run-pr-link" href="${pr}" target="_blank">View PR</a>` : nothing}
      </div>
    ` : nothing}
  </div>
` : nothing;
```

Insert `${metaStripView}` inside `.beads-panel` before `${filtersView}`.

Import `Hash` and `GitBranch` from lucide (via `icons.js` utility) and `nothing` from lit-html.

### 3. `icons.js` — Export `Hash` icon if not already exported

**File:** `.claude/worca-ui/app/utils/icons.js`

Check if `Hash` and `GitBranch` are already exported. Add any missing icon imports.

### 4. Tests — Unit tests for the metadata strip

**File:** `.claude/worca-ui/app/views/beads-panel.test.js` (or create if doesn't exist)

Write tests using the existing `renderToString` helper pattern:

- **Shows run ID** when `runId` is provided
- **Shows branch** when `run.branch` is set
- **Shows PR link** when `run.pr_url` is set
- **Hides PR link** when `run.pr_url` is absent
- **Shows both** run ID and branch when both present
- **Shows nothing** when neither run nor runId provided
- **CSS class check** — verify `run-info-section` and `run-branch` classes are present

### 5. Build

```bash
cd .claude/worca-ui && npm run build
```

## Files Modified

| File | Change |
|------|--------|
| `.claude/worca-ui/app/main.js` | Pass `run` and `runId` to `beadsPanelView` |
| `.claude/worca-ui/app/views/beads-panel.js` | Add metadata strip with run ID + branch |
| `.claude/worca-ui/app/utils/icons.js` | Export `Hash` icon (if missing) |
| `.claude/worca-ui/app/views/beads-panel.test.js` | New tests for metadata strip |

## No CSS changes needed

The existing `.run-info-section` and `.run-branch` styles already handle the layout. Reusing them keeps the beads detail view visually consistent with the run detail view.

## No server changes needed

The run data (including `branch`, `run_id`, `pr_url`) is already in `state.runs` from the WebSocket store. No new API endpoints or data fetching required.
