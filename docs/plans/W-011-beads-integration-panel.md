# W-011: Beads Integration Panel


**Goal:** Surface Beads issue data (the task management layer stored in `.beads/beads.db`) directly inside the worca-ui dashboard, eliminating the need to use the CLI to browse and select work. Users will see a live count of ready issues in the sidebar, browse and filter all open issues in a dedicated Beads view, start a pipeline run from any ready issue with one click, and visualize inter-issue dependencies in a simple graph layout.

**Architecture:** A new `server/beads-reader.js` module performs direct SQLite reads from `.beads/beads.db` using the `better-sqlite3` package (zero external process, synchronous, fast). Two new REST endpoints (`GET /api/beads/issues`, `POST /api/beads/issues/:id/start`) are added to `server/app.js`. The server watches `.beads/beads.db` for file-change events and broadcasts a `beads-update` WebSocket event so the UI reflects database mutations in real time. On the frontend, a new `beads` router section renders `views/beads-panel.js`, which contains an issue list with status/priority filtering, a "Start Pipeline" action button, and an inline SVG dependency graph rendered with pure lit-html (no external graph library). The sidebar gains a "Beads" navigation item showing the count of `ready` issues via a badge.

**Tech Stack:** Node.js `better-sqlite3` (direct DB reads), Express REST API, Node.js `fs.watch`, lit-html, Shoelace badge/button/select/dialog/tooltip components, Lucide icons, inline SVG for the dependency graph.

**Depends on:** W-000 Settings REST API (already complete). W-009 Process Manager module (already complete -- `server/process-manager.js` exports `startPipeline`).

---

## 1. Scope and Boundaries

### In scope
- `GET /api/beads/issues` -- return all open issues with status, priority, title, body, and dependency IDs
- `POST /api/beads/issues/:id/start` -- start a pipeline run whose prompt is derived from the issue title + body
- Server-side SQLite reader module for `.beads/beads.db`
- Real-time `beads-update` WebSocket broadcast when `beads.db` changes (fs.watch)
- Sidebar "Beads" section with ready-issue count badge
- Beads panel view: issue list with status and priority filter controls
- Per-issue "Start Pipeline" button (disabled when the issue is blocked or a pipeline is already running)
- Dependency visualization: inline SVG DAG rendered inside the panel for the currently visible filtered set
- Graceful degradation when `.beads/beads.db` does not exist (hide the Beads section entirely)

### Out of scope
- Creating, editing, or deleting Beads issues from the UI
- Marking issues in-progress or done (write operations beyond starting a pipeline)
- Full-featured graph layout algorithms (a simple layered/topological layout is sufficient)
- Authentication, multi-user, or remote Beads databases
- Syncing Beads state back from the pipeline into the UI (the pipeline manages its own Beads updates via `bd` CLI)
- Pagination of the issue list (Beads projects typically have < 200 issues; load all at once)

---

## 2. REST API Design

All endpoints use the existing `/api/` prefix and the `{ ok: true, ...data }` / `{ ok: false, error }` response convention established in `server/app.js`.

### `GET /api/beads/issues`

Returns all non-archived issues from `.beads/beads.db`.

**Response:**
```json
{
  "ok": true,
  "issues": [
    {
      "id": 42,
      "title": "Implement user auth",
      "body": "Add JWT-based auth to the API...",
      "status": "ready",
      "priority": "high",
      "depends_on": [38, 41],
      "blocked_by": [38],
      "created_at": "2026-03-01T10:00:00Z"
    }
  ],
  "dbExists": true
}
```

**`status` values:** `backlog`, `ready`, `in_progress`, `done`, `cancelled`

**`blocked_by`:** computed from `depends_on` -- the subset of dependency IDs whose status is not `done`/`cancelled`. Issues with a non-empty `blocked_by` cannot be started.

**When `dbExists` is false:** return `{ ok: true, issues: [], dbExists: false }` with HTTP 200. The frontend hides the Beads section in this case.

### `POST /api/beads/issues/:id/start`

Start a pipeline run whose prompt is synthesized from the issue content.

**Path parameter:** `:id` -- numeric Beads issue ID

**Validation:**
- Issue must exist in the database
- Issue `status` must be `ready` (not `done`, `in_progress`, `blocked`)
- `blocked_by` must be empty (all dependencies satisfied)
- No pipeline may currently be running (check via `getRunningPid`)

**Behavior:**
1. Load the issue by ID from SQLite
2. Build a prompt string: `"[Beads #<id>] <title>\n\n<body>"` (trimmed)
3. Call `startPipeline(worcaDir, { inputType: 'prompt', inputValue: prompt, msize: 1, mloops: 1 })`
4. Broadcast `run-started` WebSocket event so connected clients refresh
5. Return `{ ok: true, pid, issueId: id, prompt }`

**Error responses:**
- Issue not found: HTTP 404 `{ ok: false, error: "Issue 42 not found" }`
- Issue not ready: HTTP 409 `{ ok: false, error: "Issue 42 is not in 'ready' state (current: in_progress)" }`
- Issue blocked: HTTP 409 `{ ok: false, error: "Issue 42 is blocked by issues: 38" }`
- Pipeline already running: HTTP 409 `{ ok: false, error: "Pipeline already running (PID 12345)" }`

---

## 3. Server: Beads Reader Module

### New file: `server/beads-reader.js`

A stateless module that wraps `better-sqlite3` with error-safe helpers. All functions are synchronous (better-sqlite3 is synchronous by design).

**Exports:**

`dbExists(beadsDb)` -- returns `boolean`. Checks `existsSync(beadsDb)`.

`listIssues(beadsDb)` -- returns `Issue[]`. Opens the DB in read-only mode, runs:
```sql
SELECT id, title, body, status, priority, created_at
FROM issues
WHERE status NOT IN ('done', 'cancelled')
ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, id ASC
```
For each row, also queries:
```sql
SELECT depends_on_id FROM issue_dependencies WHERE issue_id = ?
```
Constructs `depends_on: number[]` per issue. Computes `blocked_by` by cross-referencing statuses: `blocked_by = depends_on.filter(depId => the dep issue is still open and not done/cancelled)`. Closes the DB before returning. Returns `[]` on any error.

`getIssue(beadsDb, id)` -- returns a single `Issue | null`. Same query as `listIssues` but with `WHERE id = ?`. Computes `depends_on` and `blocked_by` for the single issue. Returns `null` if not found or on error.

**Schema assumptions** (standard Beads schema):
- Table `issues`: columns `id INTEGER PRIMARY KEY`, `title TEXT`, `body TEXT`, `status TEXT`, `priority TEXT`, `created_at TEXT`
- Table `issue_dependencies`: columns `issue_id INTEGER`, `depends_on_id INTEGER`

**Error handling:** All exported functions catch exceptions and return safe fallback values (`[]`, `null`, `false`). The server never crashes due to a malformed or missing database.

---

## 4. Server: Real-Time Beads Watcher

### Changes to `server/ws.js`

Add a file watcher for `.beads/beads.db` alongside the existing `statusWatcher` and `activeRunWatcher`. When the database file changes, debounce and broadcast a `beads-update` event to all connected clients.

**Implementation inside `attachWsServer`**, after the existing `activeRunWatcher` setup block:

```javascript
const beadsDbPath = join(worcaDir, '..', '.beads', 'beads.db');
let beadsWatcher = null;
let BEADS_REFRESH_TIMER = null;
const BEADS_DEBOUNCE_MS = 200;

function scheduleBeadsRefresh() {
  if (BEADS_REFRESH_TIMER) clearTimeout(BEADS_REFRESH_TIMER);
  BEADS_REFRESH_TIMER = setTimeout(() => {
    BEADS_REFRESH_TIMER = null;
    try {
      const issues = listIssues(beadsDbPath);
      broadcast('beads-update', { issues, dbExists: true });
    } catch { /* ignore */ }
  }, BEADS_DEBOUNCE_MS);
}

if (existsSync(beadsDbPath)) {
  try {
    beadsWatcher = watch(beadsDbPath, () => scheduleBeadsRefresh());
  } catch { /* ignore */ }
}
```

Add `beadsWatcher` cleanup to the `wss.on('close', ...)` handler.

Note: `beadsDbPath` is derived as `join(worcaDir, '..', '.beads', 'beads.db')` -- one directory up from `.worca/` brings us to the project root, then into `.beads/`. This mirrors the relationship `worcaDir = join(projectRoot, '.worca')` established in `server/index.js`.

---

## 5. Frontend: State and Routing

### Changes to `app/state.js`

Add `beads` slice to the store initial state:

```javascript
beads: initial.beads ?? { issues: [], dbExists: false, loading: false },
```

Update the `setState` identity check to include `next.beads === state.beads`.

No new store methods are needed -- `store.setState({ beads: ... })` via the existing `setState` is sufficient.

### Changes to `app/protocol.js`

Add new message types to `MESSAGE_TYPES`:
- `'list-beads-issues'` -- client request: fetch issues on demand
- `'start-beads-issue'` -- client request: start pipeline from issue (WebSocket path)
- `'beads-update'` -- server push: broadcast when db changes

Update the `@typedef` JSDoc string to include these types.

### Routing

No changes needed to `app/router.js`. The existing `parseHash` / `navigate` / `buildHash` already support arbitrary section strings. `navigate('beads', null)` produces `#/beads` and `parseHash('#/beads')` returns `{ section: 'beads', runId: null }`.

---

## 6. Frontend: Sidebar Changes

### Changes to `app/views/sidebar.js`

**Imports to add:**
```javascript
import { List } from '../utils/icons.js';
```

**New computed values** inside `sidebarView`:
```javascript
const beadsIssues = state.beads?.issues || [];
const beadsReady = beadsIssues.filter(i => i.status === 'ready' && (i.blocked_by?.length ?? 0) === 0).length;
const beadsDbExists = state.beads?.dbExists ?? false;
```

**New sidebar section** inserted between the existing "Pipeline" `</div>` and `.sidebar-footer`:

```html
${beadsDbExists ? html`
  <div class="sidebar-section">
    <div class="sidebar-section-header">Work</div>
    <div class="sidebar-item ${route.section === 'beads' ? 'active' : ''}"
         @click=${() => onNavigate('beads')}>
      <span class="sidebar-item-left">
        ${unsafeHTML(iconSvg(List, 16))}
        <span>Beads</span>
      </span>
      ${beadsReady > 0 ? html`<sl-badge variant="success" pill>${beadsReady}</sl-badge>` : ''}
    </div>
  </div>
` : ''}
```

The badge uses `variant="success"` (green) to distinguish ready work items from the blue "Running" and neutral "History" badges.

---

## 7. Frontend: Beads Panel View

### New file: `app/views/beads-panel.js`

**Exported function:**
```javascript
export function beadsPanelView(beads, {
  statusFilter, priorityFilter, starting, startError,
  onStatusFilter, onPriorityFilter, onStartIssue, onDismissError
})
```

**Template structure:**

```
<div class="beads-panel">
  <!-- Filter bar -->
  <div class="beads-filters">
    <sl-select value=${statusFilter} @sl-change=${...}>
      <sl-option value="all">All statuses</sl-option>
      <sl-option value="ready">Ready</sl-option>
      <sl-option value="backlog">Backlog</sl-option>
      <sl-option value="in_progress">In Progress</sl-option>
    </sl-select>
    <sl-select value=${priorityFilter} @sl-change=${...}>
      <sl-option value="all">All priorities</sl-option>
      <sl-option value="high">High</sl-option>
      <sl-option value="medium">Medium</sl-option>
      <sl-option value="low">Low</sl-option>
    </sl-select>
    <span class="beads-filter-count">${filtered.length} issue${filtered.length !== 1 ? 's' : ''}</span>
  </div>

  <!-- Issue list -->
  <div class="beads-issue-list">
    ${filtered.map(issue => beadsIssueRow(issue, { starting, onStartIssue }))}
  </div>

  <!-- Dependency graph (only when multiple issues are visible) -->
  ${filtered.length > 1 ? html`
    <div class="beads-graph-section">
      <div class="beads-graph-section-title">Dependencies</div>
      <div class="beads-graph-container">
        ${unsafeHTML(beadsDependencyGraph(filtered))}
      </div>
    </div>
  ` : ''}

  <!-- Error dialog -->
  ${startError ? html`
    <sl-dialog label="Could Not Start Pipeline" open @sl-after-hide=${onDismissError}>
      <p>${startError}</p>
      <sl-button slot="footer" variant="primary" @click=${() => document.querySelector('sl-dialog[label="Could Not Start Pipeline"]')?.hide()}>
        OK
      </sl-button>
    </sl-dialog>
  ` : ''}
</div>
```

**Filtering logic** applied before rendering:
```javascript
let filtered = beads.issues ?? [];
if (statusFilter !== 'all') filtered = filtered.filter(i => i.status === statusFilter);
if (priorityFilter !== 'all') filtered = filtered.filter(i => i.priority === priorityFilter);
```

**Empty state handling** (return early before the main template):
- `beads.dbExists === false`: render `<div class="empty-state">No Beads database found. Initialize Beads with <code>bd init</code> in your project.</div>`
- `beads.loading`: render `<div class="empty-state">Loading Beads issues...</div>`
- `filtered.length === 0` with active filters: `<div class="empty-state">No issues match the current filters.</div>`
- `beads.issues.length === 0`: `<div class="empty-state">No open Beads issues found.</div>`

**`beadsIssueRow(issue, { starting, onStartIssue })`** -- internal helper:

Renders a single row:
- Priority badge: `<sl-badge variant="${priorityVariant(issue.priority)}" pill>${issue.priority}</sl-badge>`
- Status badge: `<sl-badge variant="${statusVariant(issue.status)}">${issue.status}</sl-badge>`
- Body: issue title (bold) and first 120 chars of `issue.body` (muted, ellipsized)
- Dependency chips: for each ID in `issue.depends_on`, a chip `<span class="beads-dep-chip ${issue.blocked_by.includes(id) ? 'beads-dep-chip--blocked' : ''}">`. Blocked chips prepend the lock icon.
- "Start Pipeline" `<sl-button variant="primary" size="small">` -- disabled when `issue.blocked_by.length > 0` or `starting !== null` or `issue.status !== 'ready'`. Shows spinner icon when `starting === issue.id`.

Priority variant mapping: `high -> danger`, `medium -> warning`, `low -> neutral`
Status variant mapping: `ready -> success`, `backlog -> neutral`, `in_progress -> primary`

**`beadsDependencyGraph(issues)`** -- internal helper, returns an SVG string:

Uses a two-pass topological layout:

Pass 1 -- assign layer per node (longest-path from roots using iterative relaxation):
```javascript
function computeLayers(issues) {
  const ids = new Set(issues.map(i => i.id));
  const layer = new Map(issues.map(i => [i.id, 0]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const issue of issues) {
      for (const dep of issue.depends_on) {
        if (!ids.has(dep)) continue;
        const candidate = (layer.get(dep) ?? 0) + 1;
        if (candidate > layer.get(issue.id)) {
          layer.set(issue.id, candidate);
          changed = true;
        }
      }
    }
  }
  return layer;
}
```

Pass 2 -- group by layer, assign x/y:
```
NODE_W = 140, NODE_H = 40, H_GAP = 60, V_GAP = 24, PADDING = 16
x = PADDING + layer * (NODE_W + H_GAP)
y = PADDING + indexWithinLayer * (NODE_H + V_GAP)
SVG width = PADDING*2 + (maxLayer+1)*(NODE_W+H_GAP)
SVG height = PADDING*2 + maxPerLayer*(NODE_H+V_GAP)
```

For each edge (dep -> issue), draw a cubic bezier `<path>` from the right-center of the dependency node to the left-center of the dependent node. Edges where the dependency is still blocking (`issue.blocked_by.includes(dep.id)`) use the `beads-graph-edge--blocked` class.

The SVG includes an `<defs>` block with two arrowhead markers:
- `id="beads-arrow"`: neutral color for normal edges
- `id="beads-arrow-blocked"`: red color for blocked edges

Node `<g>` elements use class `beads-graph-node beads-graph-node--${statusClass(issue)}` where `statusClass` returns `ready`, `in_progress`, `blocked` (if `blocked_by` non-empty), or `backlog`.

Each node contains:
- `<rect width="140" height="40" rx="6">`
- `<text x="8" y="14" class="beads-graph-node-id">#${id}</text>` (small, muted)
- `<text x="8" y="28">${title.slice(0, 18)}${title.length > 18 ? '...' : ''}</text>` (main label)

Return the completed SVG string (not a lit-html template; the caller wraps it with `unsafeHTML`).

---

## 8. Server: New WebSocket Handlers in `server/ws.js`

Add two new request handlers inside `handleMessage`, before the "Unknown type" fallthrough:

**`list-beads-issues`:**
```javascript
if (req.type === 'list-beads-issues') {
  if (!dbExists(beadsDbPath)) {
    ws.send(JSON.stringify(makeOk(req, { issues: [], dbExists: false })));
    return;
  }
  const issues = listIssues(beadsDbPath);
  ws.send(JSON.stringify(makeOk(req, { issues, dbExists: true })));
  return;
}
```

**`start-beads-issue`** (WebSocket mirror of the REST endpoint, consistent with `stop-run`/`resume-run` pattern):
```javascript
if (req.type === 'start-beads-issue') {
  const { issueId } = req.payload || {};
  if (!Number.isInteger(issueId) || issueId <= 0) {
    ws.send(JSON.stringify(makeError(req, 'bad_request', 'payload.issueId (positive integer) required')));
    return;
  }
  const issue = getIssue(beadsDbPath, issueId);
  if (!issue) {
    ws.send(JSON.stringify(makeError(req, 'not_found', `Issue ${issueId} not found`)));
    return;
  }
  if (issue.status !== 'ready') {
    ws.send(JSON.stringify(makeError(req, 'not_ready', `Issue ${issueId} is not ready (status: ${issue.status})`)));
    return;
  }
  if (issue.blocked_by.length > 0) {
    ws.send(JSON.stringify(makeError(req, 'blocked', `Issue ${issueId} is blocked by: ${issue.blocked_by.join(', ')}`)));
    return;
  }
  try {
    const prompt = `[Beads #${issue.id}] ${issue.title}\n\n${(issue.body || '').trim()}`.trim();
    const result = await startPipeline(worcaDir, { inputType: 'prompt', inputValue: prompt, msize: 1, mloops: 1 });
    broadcast('run-started', { pid: result.pid });
    ws.send(JSON.stringify(makeOk(req, { pid: result.pid, issueId })));
  } catch (e) {
    ws.send(JSON.stringify(makeError(req, 'start_failed', e.message)));
  }
  return;
}
```

Note: `handleMessage` must be declared `async` (or the `start-beads-issue` handler must use `.then/.catch` instead of `await`) to support the `await startPipeline(...)` call. Check the existing function signature -- if it is already `async function handleMessage`, no change is needed to the signature.

---

## 9. Server: REST Endpoint Implementation Details

### Changes to `server/app.js`

Add at top:
```javascript
import { listIssues, getIssue, dbExists } from './beads-reader.js';
import { startPipeline } from './process-manager.js';
import { join } from 'node:path';
```

Update `createApp` options destructuring:
```javascript
const { settingsPath, worcaDir } = options;
```

Add before `app.use(express.static(appDir))`:

**`GET /api/beads/issues`:**
```javascript
app.get('/api/beads/issues', (_req, res) => {
  if (!worcaDir) return res.status(501).json({ ok: false, error: 'worcaDir not configured' });
  const beadsDbPath = join(worcaDir, '..', '.beads', 'beads.db');
  if (!dbExists(beadsDbPath)) {
    return res.json({ ok: true, issues: [], dbExists: false });
  }
  try {
    const issues = listIssues(beadsDbPath);
    res.json({ ok: true, issues, dbExists: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

**`POST /api/beads/issues/:id/start`:**
```javascript
app.post('/api/beads/issues/:id/start', async (req, res) => {
  if (!worcaDir) return res.status(501).json({ ok: false, error: 'worcaDir not configured' });
  const issueId = parseInt(req.params.id, 10);
  if (!Number.isInteger(issueId) || issueId <= 0) {
    return res.status(400).json({ ok: false, error: 'Issue ID must be a positive integer' });
  }
  const beadsDbPath = join(worcaDir, '..', '.beads', 'beads.db');
  const issue = getIssue(beadsDbPath, issueId);
  if (!issue) {
    return res.status(404).json({ ok: false, error: `Issue ${issueId} not found` });
  }
  if (issue.status !== 'ready') {
    return res.status(409).json({ ok: false, error: `Issue ${issueId} is not in 'ready' state (current: ${issue.status})` });
  }
  if (issue.blocked_by.length > 0) {
    return res.status(409).json({ ok: false, error: `Issue ${issueId} is blocked by issues: ${issue.blocked_by.join(', ')}` });
  }
  try {
    const prompt = `[Beads #${issue.id}] ${issue.title}\n\n${(issue.body || '').trim()}`.trim();
    const result = await startPipeline(worcaDir, { inputType: 'prompt', inputValue: prompt, msize: 1, mloops: 1 });
    if (req.app.locals.broadcast) {
      req.app.locals.broadcast('run-started', { pid: result.pid });
    }
    res.json({ ok: true, pid: result.pid, issueId, prompt });
  } catch (err) {
    const status = (err.message || '').includes('already running') ? 409 : 500;
    res.status(status).json({ ok: false, error: err.message });
  }
});
```

### Changes to `server/index.js`

```javascript
const worcaDir = join(projectRoot, '.worca');
const app = createApp({
  settingsPath: join(projectRoot, '.claude', 'settings.json'),
  worcaDir,
});
const server = createServer(app);
const { broadcast } = attachWsServer(server, {
  worcaDir,
  settingsPath: join(projectRoot, '.claude', 'settings.json'),
  prefsPath: join(homedir(), '.worca', 'preferences.json'),
});
app.locals.broadcast = broadcast;
```

---

## 10. Icons

### Changes to `app/utils/icons.js`

Add imports:
```javascript
import List from 'lucide/dist/esm/icons/list';
import Lock from 'lucide/dist/esm/icons/lock';
import ArrowRight from 'lucide/dist/esm/icons/arrow-right';
```

Add to the export block at the bottom:
```javascript
export { ..., List, Lock, ArrowRight };
```

`List` is the sidebar icon for the Beads section.
`Lock` is shown on blocked dependency chips inside issue rows.
`ArrowRight` is available for future use in the graph or action buttons.

---

## 11. CSS

### Changes to `app/styles.css`

Append the following blocks at the end of the file (after the last existing rule):

```css
/* ============================================================
   Beads Integration Panel
   ============================================================ */

.beads-panel {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 0 0 40px;
}

/* --- Filter bar --- */

.beads-filters {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.beads-filters sl-select {
  min-width: 160px;
}

.beads-filter-count {
  margin-left: auto;
  font-size: 13px;
  color: var(--muted);
}

/* --- Issue list --- */

.beads-issue-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.beads-issue-row {
  display: grid;
  grid-template-columns: auto auto 1fr auto;
  align-items: start;
  gap: 10px 14px;
  padding: 14px 16px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  transition: box-shadow var(--transition-fast);
}

.beads-issue-row:hover {
  box-shadow: var(--shadow-md);
}

.beads-issue-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.beads-issue-title {
  font-weight: 600;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.beads-issue-excerpt {
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.beads-issue-deps {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.beads-dep-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px;
  font-size: 11px;
  border-radius: 999px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  color: var(--muted);
}

.beads-dep-chip--blocked {
  border-color: var(--status-error);
  color: var(--status-error);
}

.beads-issue-actions {
  display: flex;
  align-items: flex-start;
  padding-top: 2px;
}

/* --- Dependency graph --- */

.beads-graph-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.beads-graph-section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.beads-graph-container {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-secondary);
  padding: 16px;
}

.beads-graph-container svg {
  display: block;
}

.beads-graph-node rect {
  fill: var(--bg);
  stroke: var(--border);
  stroke-width: 1.5;
}

.beads-graph-node--ready rect {
  stroke: var(--status-completed);
}

.beads-graph-node--in_progress rect {
  stroke: var(--status-in-progress);
}

.beads-graph-node--blocked rect {
  stroke: var(--status-error);
  stroke-dasharray: 4 2;
}

.beads-graph-node text {
  font-size: 11px;
  font-family: var(--sl-font-sans);
  fill: var(--fg);
}

.beads-graph-node-id {
  font-size: 10px;
  fill: var(--muted);
}

.beads-graph-edge {
  fill: none;
  stroke: var(--border);
  stroke-width: 1.5;
}

.beads-graph-edge--blocked {
  stroke: var(--status-error);
  stroke-dasharray: 4 2;
}
```

---

## 12. Dependency: better-sqlite3

### Changes to `package.json` in `.claude/worca-ui/`

Add `better-sqlite3` to `"dependencies"`:
```json
"better-sqlite3": "^9.6.0"
```

Install command (run from `.claude/worca-ui/`):
```bash
npm install better-sqlite3 --save
```

`better-sqlite3` is a native Node.js addon requiring `node-gyp` (python3 + C++ build tools). These are standard in most development environments. If compilation fails, the fallback is to shell out to the `sqlite3` CLI using `execFileSync('sqlite3', [beadsDbPath, queryString])` and parse the TSV output -- this is significantly more fragile and should only be used if the native build cannot be resolved.

---

## 13. Implementation Tasks

### Task 1: Install better-sqlite3

**Files:**
- Modify: `.claude/worca-ui/package.json`

Run from `.claude/worca-ui/`:
```bash
npm install better-sqlite3 --save
```

Verify `node_modules/better-sqlite3` exists and `require('better-sqlite3')` does not throw. If native compilation fails, note the error in a code comment and implement the sqlite3 CLI fallback path in Task 2 instead.

---

### Task 2: Create `server/beads-reader.js`

**Files:**
- Create: `.claude/worca-ui/server/beads-reader.js`

Implement `dbExists`, `listIssues`, and `getIssue` as described in Section 3 and Section 7 (implementation detail). Full reference implementation:

```javascript
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';

export function dbExists(beadsDb) {
  return existsSync(beadsDb);
}

export function listIssues(beadsDb) {
  let db;
  try {
    db = new Database(beadsDb, { readonly: true, fileMustExist: true });
    const rows = db.prepare(
      `SELECT id, title, body, status, priority, created_at
       FROM issues
       WHERE status NOT IN ('done','cancelled')
       ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, id ASC`
    ).all();

    const depStmt = db.prepare(
      `SELECT depends_on_id FROM issue_dependencies WHERE issue_id = ?`
    );
    // Build a status map for all visible issues to compute blocked_by
    const statusMap = new Map(rows.map(r => [r.id, r.status]));

    return rows.map(row => {
      const depends_on = depStmt.all(row.id).map(d => d.depends_on_id);
      // A dependency blocks this issue if it is still in the result set
      // (meaning it is not done/cancelled). Dependencies filtered out of
      // the result set are considered done/cancelled and therefore unblocking.
      const blocked_by = depends_on.filter(depId => statusMap.has(depId));
      return { ...row, depends_on, blocked_by };
    });
  } catch {
    return [];
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

export function getIssue(beadsDb, id) {
  let db;
  try {
    db = new Database(beadsDb, { readonly: true, fileMustExist: true });
    const row = db.prepare(
      `SELECT id, title, body, status, priority, created_at
       FROM issues WHERE id = ?`
    ).get(id);
    if (!row) return null;

    const depends_on = db.prepare(
      `SELECT depends_on_id FROM issue_dependencies WHERE issue_id = ?`
    ).all(id).map(d => d.depends_on_id);

    const blocked_by = [];
    for (const depId of depends_on) {
      const dep = db.prepare(
        `SELECT status FROM issues WHERE id = ?`
      ).get(depId);
      if (dep && dep.status !== 'done' && dep.status !== 'cancelled') {
        blocked_by.push(depId);
      }
    }
    return { ...row, depends_on, blocked_by };
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}
```

---

### Task 3: Add WebSocket Handlers to `server/ws.js`

**Files:**
- Modify: `.claude/worca-ui/server/ws.js`

1. Add to imports at the top of the file:
   ```javascript
   import { listIssues, getIssue, dbExists } from './beads-reader.js';
   ```
   Also add `startPipeline` to the existing import from `./process-manager.js` if it is not already imported.

2. At the top of `attachWsServer`, compute `beadsDbPath` (alongside `worcaDir`):
   ```javascript
   const beadsDbPath = join(worcaDir, '..', '.beads', 'beads.db');
   ```

3. Add the beads file watcher block (full code from Section 4) after the `activeRunWatcher` try/catch block.

4. Add `if (beadsWatcher) beadsWatcher.close();` to the `wss.on('close', ...)` cleanup.

5. Add the `list-beads-issues` and `start-beads-issue` handler blocks inside `handleMessage` (full code from Section 8) before the final "Unknown type" handler.

6. If `handleMessage` is declared as `function handleMessage(ws, data)` (not async), change it to `async function handleMessage(ws, data)` to support `await startPipeline(...)`.

---

### Task 4: Add REST Endpoints to `server/app.js` and Update `server/index.js`

**Files:**
- Modify: `.claude/worca-ui/server/app.js`
- Modify: `.claude/worca-ui/server/index.js`

**Changes to `server/app.js`:**
- Add the three new imports at the top (Section 9)
- Destructure `worcaDir` from `options`
- Insert the two route handlers before `app.use(express.static(appDir))`

**Changes to `server/index.js`:**
- Store `worcaDir` as a `const`
- Pass it to both `createApp` and `attachWsServer`
- Destructure `{ broadcast }` from `attachWsServer` return value
- Assign `app.locals.broadcast = broadcast`

Full reference code in Section 9.

---

### Task 5: Update `app/protocol.js`

**Files:**
- Modify: `.claude/worca-ui/app/protocol.js`

Add three new message type strings to `MESSAGE_TYPES`:
```javascript
'list-beads-issues', 'start-beads-issue',
'beads-update',
```

Update the `@typedef` JSDoc comment at the top to include the three new types in the union string.

---

### Task 6: Update `app/state.js`

**Files:**
- Modify: `.claude/worca-ui/app/state.js`

1. Add `beads` field to the `state` object initializer:
   ```javascript
   beads: initial.beads ?? { issues: [], dbExists: false, loading: false },
   ```

2. Add `beads` to the `setState` identity check:
   ```javascript
   next.beads === state.beads &&
   ```

   Place this condition alongside the existing ones so no-op patches do not trigger re-renders.

---

### Task 7: Add Icons to `app/utils/icons.js`

**Files:**
- Modify: `.claude/worca-ui/app/utils/icons.js`

Add three imports and add them to the re-export block:
```javascript
import List from 'lucide/dist/esm/icons/list';
import Lock from 'lucide/dist/esm/icons/lock';
import ArrowRight from 'lucide/dist/esm/icons/arrow-right';
```

In the export line at the bottom, append `, List, Lock, ArrowRight`.

---

### Task 8: Update `app/views/sidebar.js`

**Files:**
- Modify: `.claude/worca-ui/app/views/sidebar.js`

1. Add `List` to the destructured import from `../utils/icons.js`.

2. Compute `beadsIssues`, `beadsReady`, and `beadsDbExists` inside `sidebarView` (full code from Section 6).

3. Insert the "Work" sidebar section between the closing `</div>` of the Pipeline section and the `.sidebar-footer` `<div>` (full template from Section 6).

---

### Task 9: Create `app/views/beads-panel.js`

**Files:**
- Create: `.claude/worca-ui/app/views/beads-panel.js`

Implement the full view as described in Sections 7. Inline all helpers (`beadsIssueRow`, `beadsDependencyGraph`, `computeLayers`, `priorityVariant`, `statusVariant`, `statusClass`) inside this single file.

**Required imports at the top:**
```javascript
import { html } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { iconSvg, Lock, Loader } from '../utils/icons.js';
```

Key implementation constraints:
- `beadsDependencyGraph` must return a plain string (not a lit-html template), suitable for `unsafeHTML`
- The SVG must include `xmlns="http://www.w3.org/2000/svg"` for standalone rendering
- Node coordinates must be integers (use `Math.round`)
- The graph must render correctly for both a single-chain dependency (A -> B -> C) and a diamond (A -> B, A -> C, B -> D, C -> D)
- The graph must not crash on an empty `issues` array (return empty string in that case)

---

### Task 10: Update `app/main.js`

**Files:**
- Modify: `.claude/worca-ui/app/main.js`

Apply all changes from Section 5 (Frontend: State and Routing) in this order:

1. Add `import { beadsPanelView } from './views/beads-panel.js';` to the imports block.

2. Add four module-level state variables after the existing `pipelineAction`/`actionError` declarations.

3. Add `ws.on('beads-update', ...)` handler in the WS events section.

4. Add `ws.send('list-beads-issues')` fetch inside the `ws.onConnection` open block, after the existing `list-runs` and `get-preferences` fetches.

5. Add the four action handler functions in the Actions section.

6. In `contentHeaderView()`, add the `beads` section title case.

7. In `mainContentView()`, add the `beads` branch calling `beadsPanelView` before the `dashboardView` fallthrough.

---

### Task 11: Add CSS to `app/styles.css`

**Files:**
- Modify: `.claude/worca-ui/app/styles.css`

Append all CSS rules from Section 11 verbatim to the bottom of the file. Do not modify any existing rules.

---

### Task 12: Rebuild the Frontend Bundle

**Files:**
- Rebuild: `.claude/worca-ui/app/main.bundle.js`

Run from `.claude/worca-ui/`:
```bash
npm run build
```

If no `build` script exists in `package.json`, use:
```bash
npx esbuild app/main.js --bundle --outfile=app/main.bundle.js --format=esm --minify
```

Confirm the command exits with code 0 and `main.bundle.js` is updated (check mtime). Fix any import resolution errors before proceeding to tests.

---

### Task 13: Write Unit Tests for `server/beads-reader.js`

**Files:**
- Create: `.claude/worca-ui/server/beads-reader.test.js`

Use Vitest (already used by the project -- see `*.test.js` files). Create a temporary in-memory SQLite database per test using `better-sqlite3`:

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { dbExists, listIssues, getIssue } from './beads-reader.js';

let tmpDir, dbPath, db;

function setupDb(rows = [], deps = []) {
  tmpDir = mkdtempSync(join(tmpdir(), 'beads-test-'));
  dbPath = join(tmpDir, 'beads.db');
  db = new Database(dbPath);
  db.exec(`
    CREATE TABLE issues (id INTEGER PRIMARY KEY, title TEXT, body TEXT,
      status TEXT, priority TEXT, created_at TEXT);
    CREATE TABLE issue_dependencies (issue_id INTEGER, depends_on_id INTEGER);
  `);
  const insertIssue = db.prepare(
    `INSERT INTO issues VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertDep = db.prepare(
    `INSERT INTO issue_dependencies VALUES (?, ?)`
  );
  for (const r of rows) insertIssue.run(r.id, r.title, r.body, r.status, r.priority, r.created_at || '');
  for (const d of deps) insertDep.run(d.issue_id, d.depends_on_id);
  db.close();
}

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});
```

**Tests to include:**

- `dbExists` returns `false` for a non-existent path
- `dbExists` returns `true` when the db file exists
- `listIssues` returns `[]` for a non-existent path
- `listIssues` excludes done and cancelled issues
- `listIssues` returns correct `depends_on` array
- `listIssues`: issue with done dependency has `blocked_by = []`
- `listIssues`: issue with open dependency has `blocked_by = [depId]`
- `listIssues`: issue with no dependencies has `depends_on = []` and `blocked_by = []`
- `getIssue` returns `null` for a non-existent ID
- `getIssue` returns correct issue with `depends_on` and `blocked_by`
- `getIssue` with a done dependency: `blocked_by` is empty
- `listIssues` returns `[]` on a corrupt DB (wrong schema) without throwing
- `getIssue` returns `null` on a corrupt DB without throwing

Run tests with `npm test` in the `worca-ui` directory and confirm they all pass.

---

## 14. Rollout Order

1. **Task 1** (install better-sqlite3) -- foundational; all server tasks depend on it
2. **Task 2** (beads-reader.js) -- depends on Task 1
3. **Task 5** (protocol.js) -- independent; complete early to unblock frontend
4. **Task 6** (state.js) -- independent
5. **Task 7** (icons.js) -- independent
6. **Task 3** (ws.js handlers + watcher) -- depends on Task 2
7. **Task 4** (REST endpoints + index.js) -- depends on Task 2
8. **Task 8** (sidebar.js) -- depends on Tasks 5, 7
9. **Task 9** (beads-panel.js) -- depends on Tasks 5, 6, 7
10. **Task 10** (main.js) -- depends on Tasks 5, 6, 8, 9
11. **Task 11** (styles.css) -- depends on Tasks 8, 9 (class names finalized)
12. **Task 12** (rebuild bundle) -- depends on all frontend tasks (5-11)
13. **Task 13** (unit tests) -- depends on Task 2; run after Task 12 for final validation

---

## 15. Acceptance Criteria

### Functional

- [ ] When `.beads/beads.db` does not exist, the Beads sidebar section is hidden and no errors appear in the browser console or server logs
- [ ] When `.beads/beads.db` exists, the sidebar shows a "Beads" navigation item with a green badge showing the count of unblocked ready issues (status `ready` and `blocked_by` is empty)
- [ ] Navigating to `#/beads` renders the Beads panel with the issue list
- [ ] The issue list displays all non-done/non-cancelled issues with their status, priority, title, and body excerpt
- [ ] The status filter (`all`, `ready`, `backlog`, `in_progress`) correctly narrows the visible issue list; the count label updates
- [ ] The priority filter (`all`, `high`, `medium`, `low`) correctly narrows the visible issue list
- [ ] An issue that depends on an unfinished issue shows locked dependency chips and has its "Start Pipeline" button disabled
- [ ] An unblocked `ready` issue has an enabled "Start Pipeline" button
- [ ] Clicking "Start Pipeline" on a ready issue POSTs to `/api/beads/issues/:id/start`, triggers a pipeline run, and navigates the user to `#/active`
- [ ] If a pipeline is already running when "Start Pipeline" is clicked, an error dialog appears with the server's error message; no crash or silent failure
- [ ] The dependency graph renders as an SVG DAG with correctly positioned nodes and directional edges for all visible issues
- [ ] Modifying `.beads/beads.db` externally causes the sidebar count and issue list to update within ~400ms without a page reload
- [ ] `GET /api/beads/issues` returns `{ ok: true, issues: [...], dbExists: true }` when the db exists, or `{ ok: true, issues: [], dbExists: false }` when it does not
- [ ] `POST /api/beads/issues/:id/start` returns HTTP 404 for unknown IDs, HTTP 409 for blocked/non-ready issues or a running pipeline, and HTTP 200 with `{ ok: true, pid }` on success

### Tests

- [ ] All 14 tests in `server/beads-reader.test.js` pass (`npm test` in `.claude/worca-ui/`)
- [ ] All pre-existing tests continue to pass (no regressions introduced)

### Non-functional

- [ ] No uncaught exceptions in browser console when `beads.db` is absent
- [ ] `beads-reader.js` never propagates exceptions to callers; all errors are caught and return safe defaults
- [ ] Dependency graph does not cause horizontal overflow in the main layout (contained in a scrollable wrapper)
- [ ] The sidebar ready-count badge is populated immediately on WebSocket connect (via `list-beads-issues` response), not only after the first `beads-update` event
- [ ] Server startup succeeds even when `.beads/beads.db` does not exist (no watcher error)

---

## 16. File Summary

### New files
| File | Purpose |
|------|---------|
| `.claude/worca-ui/server/beads-reader.js` | SQLite reader for `.beads/beads.db` -- `listIssues`, `getIssue`, `dbExists` |
| `.claude/worca-ui/server/beads-reader.test.js` | Vitest unit tests for the beads reader (14 cases) |
| `.claude/worca-ui/app/views/beads-panel.js` | Beads panel view: issue list, filter controls, SVG dependency graph |

### Modified files
| File | Changes |
|------|---------|
| `.claude/worca-ui/package.json` | Add `better-sqlite3` to dependencies |
| `.claude/worca-ui/server/ws.js` | Add `beadsDbPath`, `beadsWatcher`, `scheduleBeadsRefresh`, `list-beads-issues` handler, `start-beads-issue` handler |
| `.claude/worca-ui/server/app.js` | Accept `worcaDir` in options; add `GET /api/beads/issues` and `POST /api/beads/issues/:id/start` routes |
| `.claude/worca-ui/server/index.js` | Pass `worcaDir` to `createApp`; assign `app.locals.broadcast` from `attachWsServer` return value |
| `.claude/worca-ui/app/protocol.js` | Add `list-beads-issues`, `start-beads-issue`, `beads-update` to `MESSAGE_TYPES` and typedef |
| `.claude/worca-ui/app/state.js` | Add `beads` slice to initial state; add to identity-check condition |
| `.claude/worca-ui/app/utils/icons.js` | Add `List`, `Lock`, `ArrowRight` imports and exports |
| `.claude/worca-ui/app/views/sidebar.js` | Add "Work / Beads" section with ready-count badge and conditional visibility |
| `.claude/worca-ui/app/main.js` | Add `beads-update` WS handler, `list-beads-issues` on-connect fetch, filter/start action handlers, `beads` routing branch |
| `.claude/worca-ui/app/styles.css` | Append `.beads-panel`, `.beads-filters`, `.beads-issue-*`, `.beads-graph-*` CSS rules |
| `.claude/worca-ui/app/main.bundle.js` | Rebuilt from source after all frontend changes complete |
