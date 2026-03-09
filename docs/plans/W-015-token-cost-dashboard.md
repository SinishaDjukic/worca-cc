# W-015: Token & Cost Dashboard

## Status: Draft
## Depends on: W-006 (Cost & Token Tracking)

---

## 1. Goal & Scope

Add token usage and cost visibility to the worca-ui dashboard so operators can
monitor spend per run, per stage, per model, and over time. This includes:

- A **Total Cost** stat card on the main dashboard.
- A **cost breakdown section** on the run-detail page.
- A **dedicated `/#/costs` view** with sortable tables, bar charts, and a
  cumulative cost-over-time line chart.
- Two new **REST-style WebSocket request types** (`get-costs` and
  `get-run-costs`) that aggregate token/cost data from run result files.

Out of scope: budget alerts, cost projections, export to CSV, and rate-limit
tracking. These can follow in later work items.

---

## 2. Data Source (W-006 Token Schema)

W-006 adds per-iteration token tracking to the run results JSON. The assumed
schema stored in `.worca/status.json` (live) and `.worca/results/{run_id}.json`
(archived) is:

```
{
  "stages": {
    "<stage_key>": {
      "iterations": [
        {
          "number": 1,
          "model": "claude-sonnet-4-20250514",
          "turns": 12,
          "tokens": {
            "input": 48200,
            "output": 9300,
            "cache_read": 32000,
            "cache_write": 8000
          },
          "cost_usd": 0.42,
          ...
        }
      ]
    }
  },
  "total_cost_usd": 3.18,
  "total_tokens": {
    "input": 192800,
    "output": 37200,
    "cache_read": 128000,
    "cache_write": 32000
  }
}
```

Key fields consumed by W-015:

| Field | Location | Description |
|---|---|---|
| `iter.tokens.input` | iteration | Input tokens for this iteration |
| `iter.tokens.output` | iteration | Output tokens for this iteration |
| `iter.tokens.cache_read` | iteration | Cached input tokens read |
| `iter.tokens.cache_write` | iteration | Cached input tokens written |
| `iter.cost_usd` | iteration | USD cost for this iteration |
| `iter.model` | iteration | Model identifier string |
| `total_cost_usd` | run root | Summed cost across all stages |
| `total_tokens` | run root | Summed token counts across all stages |

If `total_cost_usd` or `total_tokens` are absent on a run, the server will
compute them by summing iteration-level values.

---

## 3. WebSocket API Endpoints

The existing app uses WebSocket request/response (not REST HTTP). Follow the
same pattern as `list-runs`, `subscribe-run`, etc.

### 3.1 `get-costs` -- Aggregated cost data across all runs

**Request:**
```json
{ "id": "...", "type": "get-costs", "payload": {} }
```

**Response payload:**
```json
{
  "totalCost": 42.17,
  "totalTokens": { "input": 1200000, "output": 380000, "cache_read": 800000, "cache_write": 160000 },
  "runs": [
    {
      "id": "a1b2c3d4e5f6",
      "title": "Add user auth",
      "started_at": "2025-05-10T14:22:00Z",
      "completed_at": "2025-05-10T14:48:00Z",
      "cost_usd": 3.18,
      "tokens": { "input": 192800, "output": 37200, "cache_read": 128000, "cache_write": 32000 },
      "stages": {
        "planner": { "cost_usd": 0.82, "model": "claude-opus-4-20250514" },
        "implementer": { "cost_usd": 1.14, "model": "claude-sonnet-4-20250514" },
        "tester": { "cost_usd": 0.56, "model": "claude-sonnet-4-20250514" },
        "guardian": { "cost_usd": 0.66, "model": "claude-opus-4-20250514" }
      },
      "modelBreakdown": {
        "claude-opus-4-20250514": { "cost_usd": 1.48, "input": 40000, "output": 12000 },
        "claude-sonnet-4-20250514": { "cost_usd": 1.70, "input": 152800, "output": 25200 }
      }
    }
  ]
}
```

### 3.2 `get-run-costs` -- Per-run cost breakdown

**Request:**
```json
{ "id": "...", "type": "get-run-costs", "payload": { "runId": "a1b2c3d4e5f6" } }
```

**Response payload:**
```json
{
  "runId": "a1b2c3d4e5f6",
  "cost_usd": 3.18,
  "tokens": { "input": 192800, "output": 37200, "cache_read": 128000, "cache_write": 32000 },
  "stages": [
    {
      "key": "planner",
      "label": "Planner",
      "cost_usd": 0.82,
      "tokens": { "input": 40000, "output": 8000, "cache_read": 24000, "cache_write": 8000 },
      "model": "claude-opus-4-20250514",
      "iterations": [
        { "number": 1, "cost_usd": 0.82, "tokens": { "input": 40000, "output": 8000 }, "model": "claude-opus-4-20250514" }
      ]
    }
  ],
  "modelBreakdown": {
    "claude-opus-4-20250514": { "cost_usd": 1.48, "input": 40000, "output": 12000 },
    "claude-sonnet-4-20250514": { "cost_usd": 1.70, "input": 152800, "output": 25200 }
  }
}
```

---

## 4. Dashboard Integration

### 4.1 New stat card: "Total Cost"

Add a fifth stat card to the dashboard stats grid showing aggregate cost across
all discovered runs.

**Location in grid:** After the "Errors" card.

**Display:**
- Icon: `DollarSign` from Lucide (new import)
- Primary number: `$42.17` (formatted to 2 decimal places)
- Label: `Total Cost`
- Color treatment: new CSS class `stat-cost` with a teal/emerald accent
  (e.g., `#10b981`)

**Data flow:** When `list-runs` response arrives, iterate all runs and sum
`total_cost_usd` (or sum iteration costs as fallback). Store the aggregate in a
local variable inside `dashboardView()` -- no new state store field needed since
run data is already in `state.runs`.

### 4.2 Cost section on run-detail page

Add a collapsible cost summary panel below the stage panels on the run-detail
page. This panel appears only when token/cost data is present on the run.

**Contents:**
- Total run cost in large text
- Horizontal bar chart showing per-stage cost breakdown (pure CSS bars)
- Token count summary: input / output / cache read / cache write
- Model split: which models were used and their share of the cost

---

## 5. Dedicated Cost View (`/#/costs`)

A new top-level route accessible via the sidebar. Contains three sections:

### 5.1 Per-run cost table

A sortable table of all runs with cost data.

| Column | Sortable | Format |
|---|---|---|
| Run Title | No | Truncated text, links to `/#/active?run=...` |
| Date | Yes (default: newest first) | `MMM DD, HH:mm` |
| Duration | No | `Xm Ys` |
| Total Cost | Yes | `$X.XX` |
| Input Tokens | Yes | `123.4k` |
| Output Tokens | Yes | `45.6k` |
| Model | No | Primary model badge |

Clicking a row navigates to the run-detail page.

### 5.2 Per-stage breakdown chart

A stacked horizontal bar chart showing how cost distributes across pipeline
stages for each run, or an aggregate view across all runs.

**Toggle:** "Per Run" (individual stacked bars) vs "Aggregate" (single stacked
bar showing total cost per stage summed across all runs).

**Stage colors:** Map each stage key to a consistent color from the existing
palette: planner = accent blue, implementer = green, tester = amber,
guardian = purple, coordinator = slate.

### 5.3 Cumulative cost over time

A line chart showing cumulative USD spend plotted against time. Each run
completion adds a step. This gives operators a visual sense of cost velocity.

**X-axis:** Date/time of run completion.
**Y-axis:** Cumulative cost in USD.
**Rendering:** SVG polyline with dots at each data point.

### 5.4 Model usage split

A horizontal stacked bar (or pair of bars) showing the proportion of
tokens/cost attributed to each model (e.g., Opus vs Sonnet). Helps identify
whether cost is dominated by the more expensive model.

---

## 6. Chart Library Recommendation

**Recommendation: Pure SVG + CSS bars (no external library).**

Rationale:

- The existing app has zero chart dependencies. Adding Chart.js (~200 KB
  minified) would more than double the JS payload for a handful of simple
  visualizations.
- The required charts are simple: horizontal bars, a stacked bar, and a single
  line chart. All are straightforward to render as inline SVG within lit-html
  templates.
- Pure SVG integrates naturally with lit-html's `html` tagged templates and
  `svg` namespace. No canvas mounting, no lifecycle conflicts.
- CSS custom properties already define the color palette; SVG `fill` and
  `stroke` can reference them directly via `var(--accent)`, etc.
- Tooltips can use Shoelace's `<sl-tooltip>` wrapping SVG `<rect>` or
  `<circle>` elements.

**Chart utility module:** Create `app/utils/charts.js` exporting pure functions
that return SVG template strings for use with `unsafeHTML()`:

- `horizontalBar(segments, opts)` -- single row of colored segments
- `stackedBars(data, opts)` -- multiple rows of stacked segments with labels
- `lineChart(points, opts)` -- SVG polyline with axis labels and grid

Each function accepts data arrays and returns an SVG string. Styling via CSS
classes defined in `styles.css`.

---

## 7. Implementation Tasks

### Task 1: Add new message types to protocol

**Files to modify:**
- `app/protocol.js` -- Add `'get-costs'` and `'get-run-costs'` to the
  `MESSAGE_TYPES` array.

**Changes:**
- Append the two new type strings to the exported array.
- Update the `@typedef` JSDoc for `MessageType`.

---

### Task 2: Add cost aggregation module on the server

**Files to create:**
- `server/cost-aggregator.js`

**Responsibilities:**
- Export `aggregateCosts(worcaDir)` -- reads all run results, extracts token
  and cost data, computes per-run summaries, model breakdowns, and the
  aggregate total. Returns the shape described in section 3.1.
- Export `aggregateRunCosts(worcaDir, runId)` -- reads a single run result
  (or live status), computes per-stage cost breakdown with iteration detail.
  Returns the shape described in section 3.2.
- Fallback logic: if `total_cost_usd` is missing on a run, sum
  `iter.cost_usd` across all stages. If `iter.cost_usd` is missing, skip
  that iteration (do not estimate).
- Model name normalization: strip date suffixes for display grouping
  (e.g., `claude-sonnet-4-20250514` grouped as `claude-sonnet-4`).

**Dependencies:** Reuses `discoverRuns()` from `server/watcher.js` to locate
run JSON files.

---

### Task 3: Handle new message types in WebSocket server

**Files to modify:**
- `server/ws.js` -- Add two new `if (req.type === ...)` blocks in
  `handleMessage()`.

**Changes:**
- Import `aggregateCosts` and `aggregateRunCosts` from
  `server/cost-aggregator.js`.
- `get-costs` handler: call `aggregateCosts(worcaDir)`, respond with
  `makeOk(req, result)`.
- `get-run-costs` handler: validate `payload.runId` is a string, call
  `aggregateRunCosts(worcaDir, runId)`, respond with `makeOk()` or
  `makeError()` if not found.

---

### Task 4: Add DollarSign icon import

**Files to modify:**
- `app/utils/icons.js`

**Changes:**
- Add `import DollarSign from 'lucide/dist/esm/icons/dollar-sign';`
- Add `DollarSign` to the named exports.

---

### Task 5: Add Total Cost stat card to dashboard

**Files to modify:**
- `app/views/dashboard.js`

**Changes:**
- Import `DollarSign` from `../utils/icons.js`.
- Compute `totalCost` by iterating `Object.values(state.runs)` and summing
  each run's `total_cost_usd` (fallback: sum stage iteration `cost_usd`
  values). Use a helper function `_computeTotalCost(runs)`.
- Add a fifth stat card after the errors card:
  ```
  <div class="stat-card stat-cost">
    <div class="stat-icon-ring">${unsafeHTML(iconSvg(DollarSign, 20))}</div>
    <div class="stat-body">
      <span class="stat-number">$${totalCost.toFixed(2)}</span>
      <span class="stat-label">Total Cost</span>
    </div>
  </div>
  ```
- Make the card clickable: `@click` navigates to `/#/costs`.

---

### Task 6: Add cost breakdown to run-detail page

**Files to modify:**
- `app/views/run-detail.js`

**Changes:**
- Import `horizontalBar` from `../utils/charts.js` (created in Task 8).
- After the stage panels section, add a cost summary panel wrapped in
  `<sl-details>` with summary "Cost Breakdown".
- Only render when `run.total_cost_usd != null` or any iteration has
  `cost_usd`.
- Content:
  - Large cost display: `$X.XX`
  - Horizontal bar chart showing per-stage cost as proportional colored
    segments. Each segment labeled with stage name and dollar amount.
  - Token summary row: `Input: Xk | Output: Xk | Cache: Xk`
  - Model split: inline badges showing `Opus: $X.XX` and `Sonnet: $X.XX`.

---

### Task 7: Create the costs view

**Files to create:**
- `app/views/costs.js`

**Responsibilities:**
- Export `costsView(costData, { onSelectRun })` function returning a lit-html
  template.
- Accepts cost data fetched via the `get-costs` WebSocket message.
- Renders three sections:
  1. **Cost table** -- a `<table>` with sortable column headers. Sorting is
     client-side: maintain a local `sortKey` and `sortDir` variable. Clicking a
     header toggles direction. Format numbers with `toFixed(2)` for costs and
     `(n / 1000).toFixed(1) + 'k'` for tokens.
  2. **Stage breakdown chart** -- uses `stackedBars()` from the chart utils.
     Includes a toggle button ("Per Run" / "Aggregate") that switches between
     showing one bar per run vs a single aggregate bar.
  3. **Cumulative cost chart** -- uses `lineChart()`. Data points are
     `{ x: completedAt, y: cumulativeCost }` sorted by date.
  4. **Model split** -- uses `horizontalBar()` with one segment per model.
- Row click calls `onSelectRun(runId)`.

---

### Task 8: Create SVG chart utility module

**Files to create:**
- `app/utils/charts.js`

**Exports:**

`horizontalBar(segments, opts)`:
- `segments`: `[{ value: number, color: string, label: string }]`
- `opts`: `{ width?: number, height?: number, showLabels?: boolean }`
- Returns SVG string of a single horizontal bar divided into proportional
  colored `<rect>` elements. Labels rendered as `<text>` elements centered in
  each segment when `showLabels` is true and segment is wide enough.

`stackedBars(data, opts)`:
- `data`: `[{ label: string, segments: [{ value, color, label }] }]`
- `opts`: `{ width?: number, barHeight?: number, gap?: number }`
- Returns SVG string of multiple horizontal bars stacked vertically with row
  labels on the left.

`lineChart(points, opts)`:
- `points`: `[{ x: number|Date, y: number, label?: string }]`
- `opts`: `{ width?: number, height?: number, xFormat?: fn, yFormat?: fn }`
- Returns SVG string with a polyline, grid lines, axis labels, and circular
  data point markers. Uses `viewBox` for responsive scaling.

All functions produce self-contained SVG markup (no external dependencies).
Colors should reference CSS custom properties where possible.

---

### Task 9: Add `/#/costs` route to router and main.js

**Files to modify:**
- `app/router.js` -- No code change needed; the router is generic and already
  parses any hash section string.
- `app/main.js`

**Changes to `main.js`:**
- Import `costsView` from `./views/costs.js`.
- Add a module-level variable: `let costData = null;`
- In `mainContentView()`, add a new branch before the `history` check:
  ```
  if (route.section === 'costs') {
    return costsView(costData, { onSelectRun: (runId) => navigate('active', runId) });
  }
  ```
- In `contentHeaderView()`, add a case for `route.section === 'costs'`:
  set `title = 'Token & Cost Dashboard'` and `showBack = true`.
- In `onHashChange()`, when `route.section === 'costs'`, send a `get-costs`
  WebSocket request and store the result in `costData`, then call `rerender()`.
- Register a WS event handler (or use the request/response pattern) to
  populate `costData`.

---

### Task 10: Add sidebar navigation item for Costs

**Files to modify:**
- `app/views/sidebar.js`

**Changes:**
- Import `DollarSign` from `../utils/icons.js`.
- Add a new sidebar item in a new section "Analytics" between the "Pipeline"
  section and the footer:
  ```
  <div class="sidebar-section">
    <div class="sidebar-section-header">Analytics</div>
    <div class="sidebar-item ${route.section === 'costs' ? 'active' : ''}"
         @click=${() => onNavigate('costs')}>
      <span class="sidebar-item-left">
        ${unsafeHTML(iconSvg(DollarSign, 16))}
        <span>Costs</span>
      </span>
    </div>
  </div>
  ```

---

### Task 11: Add CSS styles for cost views

**Files to modify:**
- `app/styles.css`

**New sections to add:**

**Stat card color for cost:**
- `.stat-cost .stat-icon-ring` -- background: emerald tint, color: `#10b981`.

**Cost table styles:**
- `.cost-table` -- full-width table with border-collapse.
- `.cost-table th` -- sticky header, uppercase label style matching
  `.settings-label`, sortable indicator (chevron).
- `.cost-table td` -- padding, border-bottom, tabular-nums for numbers.
- `.cost-table tr:hover` -- subtle background highlight.
- `.cost-table .cost-cell` -- right-aligned, monospace.
- `.cost-table .sort-active` -- accent color on active sort column.

**Chart container styles:**
- `.chart-container` -- margin, padding, optional title.
- `.chart-section` -- card-like wrapper with border and shadow matching
  `.stat-card`.
- `.chart-toggle` -- small button group for switching chart modes.

**SVG chart styles:**
- `.chart-bar rect` -- transition on width for animated rendering.
- `.chart-bar text` -- fill: var(--fg), font-size 11px.
- `.chart-line polyline` -- stroke: var(--accent), stroke-width 2, fill none.
- `.chart-line circle` -- fill: var(--accent), r: 3.
- `.chart-grid line` -- stroke: var(--border), stroke-dasharray: 4 2.
- `.chart-axis text` -- fill: var(--muted), font-size 10px.
- `.chart-tooltip` -- positioned absolutely, small card with shadow.

**Cost breakdown on run-detail:**
- `.cost-summary` -- flex column, gap 16px.
- `.cost-total` -- large font (22px), font-weight 700, color: `#10b981`.
- `.cost-tokens-row` -- flex row, gap 20px, monospace, muted color.
- `.cost-model-badges` -- flex row, gap 8px, inline badges.

---

### Task 12: Format utility functions

**Files to modify:**
- `app/utils/duration.js` (or create `app/utils/format.js`)

**New exports:**
- `formatCost(usd)` -- returns `$X.XX` string; returns `--` if null/undefined.
- `formatTokenCount(n)` -- returns `123.4k` for thousands, `1.2M` for
  millions; returns `0` for zero/null.
- `formatModelName(model)` -- strips date suffix, title-cases: e.g.,
  `claude-sonnet-4-20250514` becomes `Sonnet 4`.

---

## 8. Testing Strategy

### 8.1 Server-side unit tests

**File to create:** `server/cost-aggregator.test.js`

Test cases for `aggregateCosts()`:
- Returns zero totals when no runs exist.
- Correctly sums costs across multiple runs with full token data.
- Falls back to summing iteration costs when `total_cost_usd` is missing.
- Handles runs with no token data gracefully (skips them, does not throw).
- Correctly computes model breakdown groupings.
- Sorts runs by `started_at` descending.

Test cases for `aggregateRunCosts()`:
- Returns detailed stage breakdown for a known run.
- Returns error structure when runId is not found.
- Handles stages with multiple iterations.
- Handles stages with zero cost (e.g., skipped stages).

### 8.2 Client-side unit tests

**File to create:** `app/utils/charts.test.js`

Test cases:
- `horizontalBar()` returns valid SVG string with correct number of `<rect>`.
- Segment widths are proportional to values.
- Zero-value segments are omitted or rendered as zero-width.
- `lineChart()` returns SVG with a `<polyline>` containing correct point
  coordinates.
- `stackedBars()` renders the correct number of rows.

**File to create:** `app/utils/format.test.js` (if format.js is created)

Test cases:
- `formatCost(3.1)` returns `$3.10`.
- `formatCost(null)` returns `--`.
- `formatTokenCount(1500)` returns `1.5k`.
- `formatTokenCount(1200000)` returns `1.2M`.
- `formatModelName('claude-sonnet-4-20250514')` returns `Sonnet 4`.

### 8.3 Integration testing

**File to create:** `app/views/costs.test.js` (optional)

- Verify `costsView()` returns a template when given valid cost data.
- Verify `costsView()` renders an empty state when cost data is null.
- Verify table row count matches number of runs.

### 8.4 Manual testing checklist

- [ ] Navigate to `/#/costs` -- page loads without errors.
- [ ] Cost table displays all completed runs with cost data.
- [ ] Clicking column headers sorts the table correctly.
- [ ] Clicking a table row navigates to the run-detail page.
- [ ] Stage breakdown chart shows colored bars proportional to stage costs.
- [ ] Cumulative line chart renders with correct data points.
- [ ] Model split bar shows correct proportions.
- [ ] Dashboard "Total Cost" stat card shows correct aggregate.
- [ ] Clicking "Total Cost" card navigates to `/#/costs`.
- [ ] Run-detail page shows cost breakdown panel when data exists.
- [ ] Run-detail page omits cost panel when no cost data present.
- [ ] Dark theme: all chart colors, text, and backgrounds render correctly.
- [ ] Sidebar "Costs" item highlights when on `/#/costs` route.
- [ ] Charts render responsively at different viewport widths.
- [ ] Runs with partial cost data (some stages missing) render gracefully.

---

## 9. Dependencies & Ordering

```
W-006 (Cost & Token Tracking)
  |
  v
W-015 Tasks 1-4 (protocol, server module, icons)
  |
  v
W-015 Tasks 5-6 (dashboard card, run-detail cost section)
  |
  v
W-015 Tasks 7-8 (costs view, chart utilities)   -- can be parallel
  |
  v
W-015 Tasks 9-10 (routing, sidebar)
  |
  v
W-015 Task 11 (CSS styles)                      -- can be done alongside 5-10
  |
  v
W-015 Task 12 (format utilities)                -- can be done alongside 5-10
  |
  v
Testing & polish
```

**Hard dependency:** W-006 must be implemented and merged first. Without token
and cost data in the run result JSON files, the server aggregation module will
have nothing to read. During development before W-006 lands, create a fixture
file at `.worca/results/test-fixture.json` with mock cost data matching the
schema in section 2.

---

## 10. File Summary

### New files (6)

| File | Purpose |
|---|---|
| `server/cost-aggregator.js` | Server-side cost data aggregation from run results |
| `server/cost-aggregator.test.js` | Unit tests for cost aggregation |
| `app/views/costs.js` | Dedicated costs view (table, charts) |
| `app/utils/charts.js` | Pure SVG chart rendering functions |
| `app/utils/charts.test.js` | Unit tests for chart utilities |
| `app/utils/format.js` | Cost, token, and model name formatters |

### Modified files (7)

| File | Changes |
|---|---|
| `app/protocol.js` | Add `get-costs` and `get-run-costs` to `MESSAGE_TYPES` |
| `server/ws.js` | Handle `get-costs` and `get-run-costs` messages |
| `app/utils/icons.js` | Import and export `DollarSign` icon |
| `app/views/dashboard.js` | Add "Total Cost" stat card |
| `app/views/run-detail.js` | Add cost breakdown panel |
| `app/views/sidebar.js` | Add "Costs" navigation item under "Analytics" section |
| `app/main.js` | Add `costs` route handling, import costsView, fetch cost data |
| `app/styles.css` | Add cost table, chart, and stat-cost styles |
