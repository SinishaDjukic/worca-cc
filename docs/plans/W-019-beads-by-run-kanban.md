# W-019: Beads-by-Run with Kanban Visualization

## Context

The beads page currently shows all open issues globally with no way to view beads associated with a specific pipeline run. Issues are linked to runs via `external_ref = 'worca:<runId>'` in the beads DB, but this linking was broken until the recent hook fix (`ccb7e11`). Users need to:

1. Select a pipeline run and see all its beads (open, in_progress, closed)
2. See unlinked beads (issues without a run association) separately
3. Visualize run beads as a kanban board showing lifecycle progression

---

## Implementation Steps

### Step 1: Server — New SQLite queries in `beads-reader.js`

**File:** `.claude/worca-ui/server/beads-reader.js`

Add two new exported functions:

**`listUnlinkedIssues(beadsDb)`** — Issues with no `external_ref`:
```sql
SELECT id, title, description AS body, status, priority, created_at, external_ref
FROM issues
WHERE (external_ref IS NULL OR external_ref = '')
  AND status NOT IN ('closed','tombstone')
ORDER BY priority ASC, id ASC
```
Same dependency/blocked_by logic as existing `listIssues()`.

**`listDistinctExternalRefs(beadsDb)`** — All unique run refs:
```sql
SELECT DISTINCT external_ref FROM issues WHERE external_ref LIKE 'worca:%'
```
Returns array of strings like `['worca:abc123', ...]`.

### Step 2: Server — New WebSocket handlers in `ws.js`

**File:** `.claude/worca-ui/server/ws.js`

Add two handlers:
- `list-beads-unlinked` → calls `listUnlinkedIssues()`, returns `{ issues }`
- `list-beads-refs` → calls `listDistinctExternalRefs()`, returns `{ refs }`

### Step 3: Frontend — State management in `main.js`

**File:** `.claude/worca-ui/app/main.js`

New state variables:
```javascript
let beadsRunFilter = 'all';    // 'all' | 'unlinked' | runId
let beadsRunIssues = [];       // filtered issues for current run
let beadsRunLoading = false;
let beadsLinkedRefs = [];      // all external_ref values from DB
```

New handler `handleBeadsRunFilter(value)`:
- `'all'` → `ws.send('list-beads-issues')` (existing, non-closed only)
- `'unlinked'` → `ws.send('list-beads-unlinked')`
- `runId` → `ws.send('list-beads-by-run', { runId })` (all statuses)

On connection open: fetch `list-beads-refs` to populate run selector options.

On `beads-update` event: re-fetch current filter + refresh refs.

Pass new props to `beadsPanelView()`: `runFilter`, `runs`, `linkedRefs`, `onRunFilter`.

### Step 4: Frontend — Run selector dropdown in `beads-panel.js`

**File:** `.claude/worca-ui/app/views/beads-panel.js`

Add `sl-select` as the first filter, before status/priority:

```
┌─────────────────────────┐  ┌──────────────┐  ┌────────────────┐
│ All Open Issues       ▼ │  │ All statuses │  │ All priorities │
├─────────────────────────┤  └──────────────┘  └────────────────┘
│ All Open Issues         │
│ Unlinked Issues         │
│ ── Runs ──              │
│ ● Add user auth (3/11)  │  ← active runs first (● prefix)
│   Fix login bug (3/10)  │  ← title + date
│   Run abc123...         │  ← orphan refs without known run
└─────────────────────────┘
```

Helper function `buildRunOptions(runs, linkedRefs)`:
- Sort: active runs first, then by `started_at` descending
- Show truncated title + date
- Include orphan refs from `linkedRefs` not matching any `state.runs`

When run is selected, add "closed" option to status filter dropdown.

### Step 5: Frontend — Kanban board view (NEW)

**File:** `.claude/worca-ui/app/views/beads-panel.js`

New function `beadsKanbanView(issues, { starting, onStartIssue })`:

**Columns:** Open | In Progress | Closed

Each column:
- Column header with count badge
- Cards sorted by priority (P0 first)
- Each card shows: priority badge, title (truncated), issue ID

**Cards:**
```
┌──────────────────────┐
│ P2  #worca-cc-1hw    │
│ CSS styles for token │
│ & cost dashboard     │
│                      │
│ ← blocked by: #abc  │  ← only if blocked_by non-empty
└──────────────────────┘
```

**Dependency arrows:** SVG overlay connecting cards across columns using curved paths. Same arrow style as existing graph (Bezier curves, red dashed for blocked).

**Layout:** CSS grid with 3 equal columns, scrollable vertically per column.

**Rendering logic:**
- When `runFilter` is a specific run → show kanban
- When `runFilter` is `'all'` or `'unlinked'` → show existing list + dependency graph

### Step 6: Frontend — Closed issue styling in list view

**File:** `.claude/worca-ui/app/views/beads-panel.js`

Update `beadsIssueRow()`:
- Add `beads-issue-row--closed` class when `status === 'closed'`
- Hide "Start Pipeline" button for closed issues
- `statusVariant()` already handles 'closed' → 'neutral'

### Step 7: CSS styling

**File:** `.claude/worca-ui/app/styles.css`

```css
/* Kanban board */
.beads-kanban { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
.beads-kanban-column { display: flex; flex-direction: column; gap: 8px; }
.beads-kanban-header { font-weight: 600; text-transform: uppercase; font-size: 12px;
                       color: var(--text-muted); padding-bottom: 8px;
                       border-bottom: 2px solid var(--border); }
.beads-kanban-card { padding: 12px; border-radius: 8px; border: 1px solid var(--border);
                     background: var(--surface); cursor: default; }
.beads-kanban-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
.beads-kanban-card--blocked { border-color: var(--status-error); border-style: dashed; }

/* Column header colors */
.beads-kanban-header--open { border-color: var(--status-completed); }
.beads-kanban-header--in_progress { border-color: var(--status-in-progress); }
.beads-kanban-header--closed { border-color: var(--text-muted); }

/* Closed issue in list */
.beads-issue-row--closed { opacity: 0.55; }
.beads-issue-row--closed .beads-issue-title {
  text-decoration: line-through; color: var(--text-muted);
}

/* Run filter width */
.beads-filters sl-select:first-child { min-width: 240px; }
```

### Step 8: Rebuild bundle

```bash
cd .claude/worca-ui && npm run build
```

---

## Files Modified

| File | Change |
|------|--------|
| `.claude/worca-ui/server/beads-reader.js` | Add `listUnlinkedIssues()`, `listDistinctExternalRefs()` |
| `.claude/worca-ui/server/ws.js` | Add `list-beads-unlinked`, `list-beads-refs` handlers |
| `.claude/worca-ui/app/main.js` | Add run filter state, handler, WS integration |
| `.claude/worca-ui/app/views/beads-panel.js` | Add run selector, kanban view, closed issue styling |
| `.claude/worca-ui/app/styles.css` | Kanban board styles, closed issue styles |
| `.claude/worca-ui/app/main.bundle.js` | Rebuilt |

## Reuse

- `beadsDependencyGraph()` — keep for "All" / "Unlinked" views (existing)
- `priorityVariant()`, `statusVariant()` — reuse in kanban cards
- `sl-select` + `sl-option` pattern — same as existing filters
- `computeLayers()` — may adapt for kanban arrow positioning
- `formatTimestamp()` — for run dates in selector

## Verification

1. Open beads page → default "All Open Issues" shows current behavior unchanged
2. Select a specific run → kanban board appears with 3 columns, cards in correct columns
3. Verify closed beads appear in Closed column with correct styling
4. Select "Unlinked Issues" → shows only issues without `external_ref`, list + graph view
5. Dependency arrows render between kanban cards across columns
6. Status/priority filters work within run-filtered view
7. Real-time updates: create a bead via `bd create`, verify it appears
8. Run selector shows active runs with `●` prefix, sorted newest first
